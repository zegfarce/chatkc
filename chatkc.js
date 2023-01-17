import InputLoop from "https://deno.land/x/input@2.0.3/index.ts";

import auth from "./auth.json" assert { type: "json" };
import config from "./config.json" assert { type: "json" };

const wsServerURL = config.server;
const authType = auth.authType;
const authToken = auth.authToken;
const socket = new WebSocket(wsServerURL);

const inputLoop = new InputLoop();

let userData = {
	name: "nobody",
	color: "#FFFFFF",
	status: false,
	authLevel: 0,
}

let flags = {
	dump: false,
}

let activeUsers = [];
let messages = [];

function output(data) {
	console.log(data);
}

function sendSocketData(type, data) {
	let json = {
		"type": type,
		"auth": "google",
		"token": authToken
	}

	if (typeof data !== "undefined")
		json.data = data;

	socket.send(JSON.stringify(json));
}

let queueActive = false;
let lastMessage = "";
let queuedMessages = [];

function activateQueue(time) {
	if (queueActive)
		return;

	queueActive = true;

	setTimeout(() => {
		queueActive = false;

		if (queuedMessages.length)
			sendSocketData("message", queuedMessages.join("\n"));

		queuedMessages = [];
	}, time * 1000);
}

async function readLoop() {
	let data = await inputLoop.read();

	if (data.slice(0, 2) == "!!") {
		let args = data.slice(2).split(" ");

		switch (args[0]) {
		case "packet":
			sendSocketData(args[1], args[2]);
			break;
		case "set":
			if (args[2] == "true" || args[2] == "yes" || args[2] == "1")
				settings[args[1]] = true;
			else if (args[2] == "false" || args[2] == "no" || args[2] == "0")
				settings[args[1]] = false;

			break;
		default:
			output(`Unknown command ${args[0]}, args ${args.unshift().toString()}`);
			break;
		}
	} else {
		if (!queueActive) {
			lastMessage = data;	
			sendSocketData("message", data);
		} else {
			queuedMessages.push(data);
			output("! Message queued.");
		}
	}

	setTimeout(readLoop, 0);
}

function connect() {
	sendSocketData("hello", {"last_message": -1});
	sendSocketData("status", {});
	sendSocketData("getuserconf");
}

function message(json) {
	let data = json.data;

	if (flags.dump)
		output(`Packet: ${JSON.stringify(json)}`);

	switch (json.type) {
	case "status":
		switch (data.status) {
		case "unauthenticated":
			output("! You're not authenticated.");
			break;
		case "authenticated":
			output("! You're authenticated now.");
			readLoop();
			break;
		case "banned":
			output("! You've been banned. Great job.");
			break;
		case "rename":
			output("! You've been forced to rename. Gonna just exit.");
			Deno.exit();
			break;
		case "nameexists":
			output(`! The name ${userData.name} already exists.`);
			break;
		case "nametimeout":
			output(`! You cannot change your name this quickly, the timeout is 30 days per name change.`);
			break;
		case "nameinvalid":
			output(`! Name does not match /A-Za-z0-9_/.`);
			break;
		case "namelength":
			output(`! Display name must be between 5 and 32 characters long.`);
			break;
		case "setuserconf":
			output(`! User data successfully set.`);
			break;
		}
		break;
	case "servermsg":
		output(`Server message: ${data.message}`);

		if (data.message.includes("please wait")) {
			const numberMatch = data.message.match(/\d+/);
			const number = parseInt(numberMatch[0]);
			const seconds = number + 1; // account for possible floor operations

			queuedMessages.push(lastMessage); // so it didn't send
			lastMessage = "";

			output("! Queuing previous message.");
			activateQueue(seconds);
		}
	case "accepted":
		userData.name = data.name;
		userData.color = data.color;
		break;
	case "getuserconf":
		userData.name = data.name;
		userData.color = data.color;
		break;
	case "authlevel":
		userData.authLevel = data.value;
		break;
	case "join":
		output(`${data.name} has joined.`);
		activeUsers.push(data.name);
		break;
	case "part":
		output(`${data.name} has left.`);
		activeUsers.splice(activeUsers.indexOf(data.name), 1);
		break;
	case "chat":
		messages[data.id] = data;
		output(`<${data.author}> ${data.message}`)
		break;
	case "delete":
		for (let value of data.messages) {
			output(`! Message ${value} deleted by a moderator.`);
			delete messages[value];
		}
		break;
	default:
		output(`! Recieved unsupported packet type ${json.type}, data: ${JSON.stringify(data)}`)
	}
}

socket.addEventListener('open', connect);

socket.addEventListener('close', () => {
	output("Disconnected, retrying in 5 seconds...");
	setTimeout(connect, 5000);
});

socket.addEventListener('message', (event) => {
	let json = JSON.parse(event.data);
	message(json);
});
