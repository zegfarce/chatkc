# ChatKC chat client

This is a chat client that connects to a ChatKC chat server.  
It kinda works, maybe!

By default it connects to `wss://server.mattkc.com:2002`, but there isn't any reason why it can't connect to anything else.

## Running the thing

First off, you need to put your authentication method and token in `auth.json`.

Next, you need Deno. [Go get Deno.](https://deno.land/) Run it with Deno. That's about it, really.

I suggest the command `deno run --allow-net ./chatkc.js` from this directory.

## Commands

In addition to being able to chat and use server-defined commands, this includes some of its own.

The default command prefix is `!!`, but it can be configured in `config.json` to be anything else.

Below is the help text. `<arg>` is required, `[arg]` is optional.
```
!!help - this text
!!users - lists users in chat
!!see <id> - print a message by its id
!!reply <id> <message> - replies to a message
!!name [username] - changes your name
!!color [hex code] - changes your color
!!packet <type> <data> - sends an arbitrary packet to the server
!!fake <type> <json> - fakes a packet as if received from the server
!!set <flag> (true/yes/1)|(false/no/0) - sets a flag
```

## Flags

There are also a couple flags that do things.

* `dump` (default off) just dumps every ws packet to the console.
* `queue` (default on) queues messages you're sending until you're able to send them again.

## License

[0BSD](LICENSE)

go nuts, idc
