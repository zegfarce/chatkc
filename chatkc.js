import InputLoop from "https://deno.land/x/input@2.0.3/index.ts";
import { unescape } from "https://deno.land/x/html_escape@v1.1.5/unescape.ts";

import auth from "./auth.json" assert { type: "json" };
import config from "./config.json" assert { type: "json" };

const wsServerURL = config.server;
const reconnectTimeout = config.reconnectTimeout;

const authType = auth.authType;
const authToken = auth.authToken;

const inputLoop = new InputLoop();

let socket; // The websocket

// Data about your client
let userData = {
	name: null, // username
	color: "#FFFFFF", // color
	authLevel: 0, // auth level
}

// Flags that show or hide certain bits of info
let flags = {
	dump: false, // Dumps packets to the console
	queue: true, // Queues messages until they are able to be sent again
}

let activeUsers = []; // List of users in chat
let messages = []; // List of messages in chat

// Sends a ChatKC packet to the server.
function sendSocketData(type, data) {
	let json = {
		"type": type,
		"auth": authType,
		"token": authToken
	}

	// Some packet types don't send data
	if (typeof data !== "undefined")
		json.data = data;

	let rawdata = JSON.stringify(json);

	if (flags.dump) // If we're dumping packets, do
		console.log(`sent: ${rawdata}`);

	socket.send(rawdata);
}

// Chat queue for slow mode.
let queueActive = false; // Whether we're currently queuing up messages.
let lastMessage = ""; // Not necessarily always queued
let queuedMessages = []; // Messages to concatenate and send later.

// Starts queuing messages until time seconds has passed
function activateQueue(time) {
	if (queueActive || !flags.queue)
		return;

	queueActive = true;

	setTimeout(() => {
		queueActive = false;

		if (queuedMessages.length && flags.queue)
			sendSocketData("message", {text: queuedMessages.join("\n")});

		queuedMessages = [];
	}, time * 1000);
}

// Sends a message, optionally replying to another message
function sendMessage(message, reply) {
	if (!queueActive || !flags.queue) {
		lastMessage = message;
		let json = {text: message}

		if (reply)
			json.reply = reply;

		sendSocketData("message", json);
	} else { // Queue if we've been rate limited recently.
		queuedMessages.push(message);
		console.log("! Message queued.");
	}
}

// Renders a message.
function renderMessage(data) {
	let authStr = "";
	let donateStr = "";
	let replyStr = "";

	if (data.auth > 50) // Moderator check
		authStr = '~';

	if (data.donate_value) // Donation message check
		donateStr = ` (donated $${data.donate_value})`;

	if (data.reply) // Reply check
		donateStr = ` (replying to ${data.reply})`;

	// Combine string together
	return `${data.id} <${authStr}${data.author}${donateStr}${replyStr}> ${unescape(data.message)}`;
}

// Takes a list of arguments and does a thing
function handleCommand(args) {
	let pre = config.commandPrefix;

	switch (args[0]) {
	case "help": // Help text
		console.log("! Commands:");
		console.log(pre + "help - this text");
		console.log(pre + "users - lists users in chat");
		console.log(pre + "see <id> - print a message by its id");
		console.log(pre + "reply <id> <message> - replies to a message");
		console.log(pre + "name [username] - changes your name");
		console.log(pre + "color [hex code] - changes your color");
		console.log(pre + "packet <type> <data> - sends an arbitrary packet to the server");
		console.log(pre + "fake <type> <json> - fakes a packet as if received from the server");
		console.log(pre + "set <flag> (true/yes/1)|(false/no/0) - sets a flag");
		break;
	case "users": // List users.
		for (let user of activeUsers)
			console.log(user);
		break;
	case "see": // View a message by ID.
		let id = parseInt(args[1])
		let message = messages[id];

		if (typeof message !== "undefined") {
			// Try to render the replied message too
			if (message.reply && typeof messages[message.reply] !== "undefined")
				console.log('! ' + renderMessage(messages[message.reply]));
			else
				console.log('! Reply was deleted.');

			console.log('! ' + renderMessage(message));
		}
		else
			console.log(`! Message ${id} not downloaded, or nonexistent.`)

		break;
	case "reply": // Reply to a message.
		sendMessage(args.slice(2).join(" "), parseInt(args[1]));
		break;
	case "name": // Change your name.
		userData.name = args[1] ?? prompt("Username:");
		sendSocketData('setuserconf', {name: userData.name, color: userData.color.replace("#", '')});
		break;
	case "color": // Change the color you appear as in chat.
		userData.color = args[1] ?? prompt("Color:");
		sendSocketData('setuserconf', {name: userData.name, color: userData.color.replace("#", '')});
		break;
	case "packet": // Send an arbitrary packet to the server.
		sendSocketData(args[1], args[2]);
		break;
	case "fake": // Create a fake packet and act like we recieved it.
		message({"data": JSON.parse(args[2]), "type": args[1]});
		break;
	case "set": // Set a flag to either true or false.
		if (args[2] == "true" || args[2] == "yes" || args[2] == "1")
			flags[args[1]] = true;
		else if (args[2] == "false" || args[2] == "no" || args[2] == "0")
			flags[args[1]] = false;

		break;
	default:
		console.log(`! Unknown command ${args[0]}, args ${args.unshift().toString()}`);
		console.log(`! Type ${pre}help for help.`)
		break;
	}
}

// The loop that handles reading your input so you can do things !!
async function readLoop() {
	// Read a line. TODO: fix issues with other output screwing with this
	let data = await inputLoop.read();

	// Check if we're doing a command, then run the command if we are.
	if (data.slice(0, config.commandPrefix.length) == config.commandPrefix) {
		let args = data.slice(config.commandPrefix.length).split(" ");
		handleCommand(args);
	} else { // Otherwise attempt to send a message.
		sendMessage(data);
	}

	return readLoop(); // Call again
}

// Handles forcing a username change.
function forceUsernameChange() {
	let newname;

	do { // Continually prompt for a username until one is given
		newname = prompt("Username:");
	} while (newname == null);

	// Update it
	sendSocketData('setuserconf', {name: newname, color: userData.color.replace("#", '')});
}

// Send the packets to complete the connection, and put us into a good state for sending messages
function connect() {
	sendSocketData("hello", {"last_message": -1}); // Say hello, grab messages
	sendSocketData("status", {}); // Ask for user status
	sendSocketData("getuserconf"); // Get configuration
}

// Recieves a message from the server
function message(json) {
	let data = json.data;

	if (flags.dump) // If we're dumping packets, do
		console.log(`recv: ${JSON.stringify(json)}`);

	// Handle the things
	switch (json.type) {
	case "status":
		switch (data.status) {
		case "unauthenticated":
			console.log("! You're not authenticated.");
			break;
		case "authenticated":
			console.log("! You're authenticated now.");
			readLoop();
			break;
		case "banned":
			console.log("! You've been banned. Great job.");
			Deno.exit();
			break;
		case "rename":
			console.log("! This is your first time logging in, so you must pick a username.");
			forceUsernameChange();
			break;
		case "nameexists":
			console.log(`! The name ${userData.name} already exists.`);

			if (!userData.name)
				forceUsernameChange();
			break;
		case "nametimeout":
			console.log(`! You cannot change your name this quickly, the timeout is 30 days per name change.`);
			break;
		case "nameinvalid":
			console.log(`! Name does not match /A-Za-z0-9_/.`);

			if (!userData.name)
				forceUsernameChange();
			break;
		case "namelength":
			console.log(`! Display name must be between 5 and 32 characters long.`);

			if (!userData.name)
				forceUsernameChange();
			break;
		case "setuserconf":
			console.log(`! User data successfully set.`);
			break;
		default:
			console.log(`! Status ${data.status} has been inflicted upon you. I don't know what that means.`);
			break;
		}
		break;
	case "servermsg": // Server message, for things like rate limiting
		console.log(`Server message: ${data.message}`);

		// Cheap hack to get the timeout until matt adds a timeout packet to the api
		if (data.message.includes("please wait") && flags.queue) {
			const numberMatch = data.message.match(/\d+/);
			const number = parseInt(numberMatch[0]);
			const seconds = number + 1; // account for possible floor operations

			// because it didnt go through, we add it to the queue
			queuedMessages.push(lastMessage);
			lastMessage = "";

			console.log("! Queuing previous message.");
			activateQueue(seconds);
		}
	case "accepted": // message accepted
		userData.name = data.name;
		userData.color = data.color;
		break;
	case "getuserconf": // recieving user data
		userData.name = data.name;
		userData.color = data.color;
		break;
	case "authlevel": // recieving authentication level
		userData.authLevel = data.value;
		break;
	case "join": // User join
		console.log(`${data.name} has joined.`);
		activeUsers.push(data.name);
		break;
	case "part": // User leave
		console.log(`${data.name} has left.`);
		activeUsers.splice(activeUsers.indexOf(data.name), 1);
		break;
	case "chat": // User sent message
		messages[data.id] = data;
		console.log(renderMessage(data));
		break;
	case "delete": // Moderator deleted message
		for (let value of data.messages) {
			console.log(`! Message ${value} deleted by a moderator.`);
			delete messages[value];
		}
		break;
	default:
		console.log(`! Received unsupported packet type ${json.type}, data: ${JSON.stringify(data)}`)
	}
}

// Attempt to connect, and reconnect after disconnecting.
function tryConnect() {
	let timeout = setTimeout(tryConnect, reconnectTimeout);

	socket = new WebSocket(wsServerURL);

	socket.addEventListener('open', connect);

	socket.addEventListener('close', () => {
		console.log(`Disconnected, retrying in ${reconnectTimeout} ms...`);
		setInterval(tryConnect, reconnectTimeout);
	});

	socket.addEventListener('message', (event) => {
		clearTimeout(timeout);

		let json = JSON.parse(event.data);
		message(json);
	});
}

tryConnect(); // We probably wanna chat..
