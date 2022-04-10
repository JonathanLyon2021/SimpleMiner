"use strict";
var CryptoJS = require("crypto-js");
var express = require("express");
var bodyParser = require("body-parser");
var webSocket = require("ws");

class Block {
	constructor(index, previousHash, timeStamp, data, hash) {
		this.index = index;
		this.previousHash = previousHash.toString();
		this.timeStamp = timeStamp;
		this.data = data;
		this.hash = hash.toString();
	}
}

var getGenesisBlock = () => {
	return new Block(
		0,
		"0",
		1465154705,
		"my genesis block!!",
		"816534932c2b7154836da6afc367695e6337db8a921823784c14378abed4f7d7"
	);
};

var blockchain = [getGenesisBlock()];

var getLatestBlock = () => blockchain[blockchain.length - 1];

var generateNextBlock = (blockData) => {
	var previousBlock = getLatestBlock();
	var nextIndex = previousBlock.index + 1;
	var nextTimeStamp = new Date().getTime() / 1000;
	var nextHash = calculateHash(
		nextIndex,
		previousBlock.hash,
		nextTimeStamp,
		blockData
	);
	return new Block(
		nextIndex,
		previousBlock.hash,
		nextTimeStamp,
		blockData,
		nextHash
	);
};

var isValidNewBlock = (newBlock, previousBlock) => {
	if (previousBlock.index + 1 !== newBlock.index) {
		console.log("invalid index");
		return false;
	} else if (previousBlock.hash !== newBlock.previousHash) {
		console.log("invalid previous hash");
		return false;
	} else if (calculateHashForBlock(newBlock) !== newBlock.hash) {
		console.log(
			typeof newBlock.hash + " " + typeof calculateHashForBlock(newBlock)
		);
		console.log(
			"invalid hash: " +
				calculateHashForBlock(newBlock) +
				" " +
				newBlock.hash
		);
		return false;
	}
	return true;
};

var isValidChain = (blockchainToValidate) => {
	if (
		JSON.stringify(blockchainToValidate[0]) !==
		JSON.stringify(getGenesisBlock())
	) {
		return false;
	}
	var tempBlocks = [blockchainToValidate[0]];
	for (let i = 1; i < blockchainToValidate.length; i++) {
		if (isValidNewBlock(blockchainToValidate[i], tempBlocks[i - 1])) {
			tempBlocks.push(blockchainToValidate[i]);
		} else {
			return false;
		}
	}
	return true;
};

var replaceChain = (newBlocks) => {
	if (isValidChain(newBlocks) && newBlocks.length > blockchain.length) {
		console.log(
			"Received blockchain is valid. Replacing current blockchain with received blockchain"
		);
		blockchain = newBlocks;
		broadcast(responseLatestMsg());
	} else {
		console.log("Received blockchain invalid");
	}
};

var addBlock = (newBlock) => {
	if (isValidNewBlock(newBlock, getLatestBlock())) {
		blockchain.push(newBlock);
	}
};

var calculateHash = (index, previousHash, timeStamp, data) => {
	return CryptoJS.SHA256(index + previousHash + timeStamp + data).toString();
};

var calculateHashForBlock = (block) => {
	return calculateHash(
		block.index,
		block.previousHash,
		block.timeStamp,
		block.data
	);
};

function testApp() {
	function showBlockchain(inputBlockchain) {
		for (let i = 0; i < inputBlockchain.length; i++) {
			console.log(inputBlockchain[i]);
		}
		console.log();
	}
	//     varshowBlockchain(blockchain);

	//console.log(calculateHashForBlock(getGenesisBlock()));

	//addBlock Test
	//console.log("blockchain before addBlock() execution:");
	//showBlockchain(blockchain);
	//addBlock(generateNextBlock("test block data"));console.log("\n");
	//console.log("blockchain after addBlock() execution:");
	//showBlockchain(blockchain);
}

testApp();

var http_port = process.env.HTTP_PORT || 3001;

var sockets = [];

var initHttpServer = () => {
	var app = express();
	app.use(bodyParser.json());

	app.get("/blocks", (req, res) => res.send(JSON.stringify(blockchain)));
	app.post("mineBlock", (req, res) => {
		var newBlock = generateNextBlock(req.body.data);
		addBlock(newBlock);
		broadcast(responseLatestmsg());
		console.log("block added: " + JSON.stringify(newBlock));
		res.send();
	});
	app.get("peers", (req, res) => {
		res.send(
			sockets.map(
				(s) => s._socket.remoteAddress + ":" + s._socket.remotePort
			)
		);
	});
	app.post("/addPeer", (req, res) => {
		connectToPeers([req.body.peer]);
		res.send();
	});
	app.listen(http_port, () =>
		console.log("Llistening http on PORT: " + http_port)
	);
};

var p2p_port = process.env.P2P_PORT || 6001;
var initialPeers = process.env.PEERS ? process.env.PEERS.split(',') : [];
var MessageType = {
	QUERY_LATEST: 0,
	QUERY_ALL: 1,
	RESPONSE_BLOCKCHAIN: 2,
};

var queryChainLengthMsg = () => ({'type': MessageType.QUERY_LATEST});
var queryAllMsg = () => ({'type': MessageType.QUERY_ALL});
var responseChainMsg = () => ({
	'type': MessageType.RESPONSE_BLOCKCHAIN, 'data': JSON.stringify(blockchain)
});
var responseLatestMsg = () => ({ 
	'type': MessageType.RESPONSE_BLOCKCHAIN,
	'data': JSON.stringify([getLatestBlock()])
});

var handleBlockchainResponse = (message) => {
	var receivedBlocks = JSON.parse(message.data).sort((b1, b2) => (b1.index - b2.index));
	var latestBlockReceived = receivedBlocks[receivedBlocks.length - 1];
	var latestBlockHeld = getLatestBlock();
	if(latestBlockReceived.index > latestBlockHeld.index) {
		console.log('blockchain possibly behind. We got: ' + latestBlockHeld.index + 
		'Peer got: ' + latestBlockReceived.index);
		if(latestBlockHeld.hash === latestBlockReceived.previousHash){
			console.log("We can append the received block to our chain");
			addBlock(latestBlockReceived);
			broadcast(responseLatestMsg());
		}else if(receivedBlocks.length === 1){
			console.log("We have to query the chain from our peer");
			broadcast(queryAllMsg());
		}else{
			console.log("Received blockchain is longer then current blockchain");
			replaceChain(receivedBlocks);
		}
	}else {
		console.log('received blockchain is not longer than current blockchain. Do nothing');
	}
};

var initMessageHandler = (ws) => {
	ws.on('message', (data) => {
		var message = JSON.parse(data);
		console.log('Received message' + JSON.stringify(message));
		switch(message.type){
			case MessageType.QUERY_LATEST:
				write(ws, responseLatestMsg());
				break;
			case MessageType.QUERY_ALL: 
			    write(ws, responseChainMsg());
				break;
			case Message.TypeRESPONSE_BLOCKCHAIN:
				handleBlockchainResponse(message);
				break;
		}
	});
};

var initErrorHandler = (ws) => {
	var closeConnection = (ws) => {
		console.log('connection failed to peer: ' + ws.url);
		sockets.splice(sockets.indexOf(ws), 1);
	};
	ws.on('close', () => closeConnection(ws));
	ws.on('error', () => closeConnection(ws));
};

var write = (ws, message) => ws.send(JSON.stringify(message));

var initConnection = (ws) => {
	sockets.push(ws);
	initMessageHandler(ws);
	initErrorHandler(ws);
	write(ws, queryChainLengthMsg())
};

var broadcast = (message) => sockets.forEach(socket => write(socket, message));

var connectToPeers = (newPeers) => {
	newPeers.forEach((peer) => {
		var ws = new WebSocket(peer);
		ws.on('open', () => initConnection(ws));
		ws.on('error', () => {
			console.log('connection failed')
		});
	});
};

var initP2PServer = () => {
	var server = new Websocket.Server({port: p2p_port});
	server.on('connection', ws => initConnection(ws));
	console.log('listening websocket p2p port on: ' + p2p_port);
};

connectToPeers(initialPeers);
initHttpServer();
initP2PServer();


//initHttpServer();
