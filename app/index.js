// good btc punk https://opensea.io/assets/ethereum/0x82c7a8f707110f5fbb16184a5933e9f78a34c6ab/17567688516388371
const express = require('express')
var bodyParser = require('body-parser')
const { Configuration, OpenAIApi } = require("openai")
const Alchemy = require('alchemy-sdk').Alchemy
const Network = require('alchemy-sdk').Network
const rp = require('request-promise')
const cheerio = require("cheerio")
let ordinals = require("./collections/ordinals.json")
var cors = require('cors')
const configuration = new Configuration({
  apiKey: process.env.OPENAI_API_KEY,
})
const openai = new OpenAIApi(configuration)

const settings = {
    apiKey: process.env.ALCHEMY_API_KEY,
    network: Network.ETH_MAINNET,
}
const alchemy = new Alchemy(settings)

const app = express()
app.use(cors())
app.options('*', cors()) // include before other routes
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));
const port = process.env.PORT || 3000; // default port to listen

app.use(function (req, res, next) {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
  next();
});

app.options("/*", function (req, res, next) {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Content-Length, X-Requested-With');
  res.send(200);
})

app.use(express.static('public'))

// app.get('/', (req, res)=>{
//     res.json({"hello":"world"})
// })

app.get('/v1/meta', async (req, res)=>{
    let url = req.query.url
    let tokenId = url.replace('=', '/').split('/').reverse()[0]
    let metadata = await fetchMetadataFromEmblem(tokenId)
    let liveMetadata = await getMetadataFromAlchemy(url)
    let vaultBtcAddress = metadata.addresses? metadata.addresses.filter(address=>{return address.coin == 'BTC'})[0].address: "error"
    let balances = tokenId? (await fetchBalance(tokenId)).balances: null
    let assetName = metadata.name? metadata.name: metadata.rawMetadata && metadata.rawMetadata.name ? metadata.rawMetadata.name: metadata.contract.name? metadata.contract.name + " #" + metadata.tokenId : metadata.tokenId
    let properties = await classifyVaultWithGPT(assetName, metadata.description, balances.balances)
    let lowestInscriptionHash = properties.isOrdinal? fetchOrdinalHashes(properties): false
    let ordinalOwner = lowestInscriptionHash ? await fetchOwnerFromOrdinal_com(lowestInscriptionHash): properties.inscriptionLink? await fetchOwnerFromOrdinal_com(properties.inscriptionLink.split('/').reverse()[0]): null
    
    let utxoSet = await fetchUtxoFromMemPool_space(vaultBtcAddress)
    if ((properties.isOrdinal && ordinalOwner != vaultBtcAddress && utxoSet.mempool_stats.tx_count < 1)) {
        properties.risk = properties.risk+" > ⚠️ high"
        properties.reasons.push("- empty vault")
        properties.reasons.push("- no pending tx")
    } else {
        properties.reasons.push('+ ordinal owner matches vault')
    }
    return res.json({assetName, description: metadata.description, properties, balances, utxoSet})
})

app.post('/v1/classify', async (req, res) => {
    let title = req.body.title || ''
    let description = req.body.desc || ''
    let properties = await classifyVaultWithGPT(title, description)
    res.json(200,{'status':'success', properties });
})

app.listen(3000, () => {
  console.log('Server listening on port 3000');
});

function fetchOrdinalHashes(properties) {
    if (properties && properties.projectName && ordinals[properties.projectName]) {
        let collection = ordinals[properties.projectName]
        let lowestInscriptionId = collection[properties.assetId].lowest
        let lowestInscriptionHash = lowestInscriptionId ? collection[properties.assetId].hashes[collection[properties.assetId].lowest] : null
        return lowestInscriptionHash
    }
}

async function classifyVaultWithGPT(title, description, balances) {
    let payload = groupTrainingAndPrompt({ title, description, balances })

    const response = await openai.createCompletion({
        model: "text-davinci-003",
        prompt: payload,
        temperature: 0.7,
        max_tokens: 256,
        top_p: 1,
        frequency_penalty: 0,
        presence_penalty: 0,
    })
    let body = cleanAndParseJsonFromGPT(response.data.choices)
    delete body.title
    delete body.description
    return body
}

function cleanAndParseJsonFromGPT(str){
    if (str.length <1) {
        return {}
    } else {str = str[0]}
    
    str = str.text.replaceAll('\n ','').replaceAll('\n','').replace('properties = ','')
    return JSON.parse(str)
}

function groupTrainingAndPrompt(prompt){
    return JSON.stringify(training) + "\n" + JSON.stringify(prompt)
}

const fetchBalance = async (tokenId) => {
    const response = await rp(`https://api2.emblemvault.io/vault/balance/${tokenId}?live=false&_vercel_no_cache=1`);
    return JSON.parse(response);
};

const fetchMetadataFromEmblem = async (tokenId) => {
    const response = await rp(`https://api2.emblemvault.io/meta/${tokenId}?experimental=true&raw=true`);
    return JSON.parse(response);
}

const fetchOwnerFromOrdinal_com = async (inscriptionId) => {
    const response = await rp(`https://ordinals.com/inscription/${inscriptionId}`);
    return getAddress(response);
}

const getAddress = (body) => {
    const $ = cheerio.load(body);
    const address = $('dd.monospace')
      .filter((i, el) => $(el).prev().text() === 'address')
      .text();
    return address;
  };

const fetchUtxoFromMemPool_space = async (address) => {
    if (!address) return false
    const response = await rp(`https://mempool.space/api/address/${address}`);
    return JSON.parse(response);
};

const getMetadataFromAlchemy = async (openseaUrl) => {
    const path = new URL(openseaUrl).pathname.split("/")
    const tokenId = path[path.length - 1]
    const contractAddress = path[path.length - 2]
  
    const response = await alchemy.nft.getNftMetadata(contractAddress, tokenId)
    return response;
  };

  module.exports = app;

let training = {
    "instructions": ["only respond with a valid properties json object"],
    "training": [
        {
            "title": "Empty Vault Please Research before purchasing⚠️ Bitcoin Punk #6042 (Ordinal inscription #22940) - Contents Loading",
            "description": "https://ordinals.com/inscription/ed7250807a75e755f6a57d9bf804776f97cdaa7aabb3",
            "balances": [],
            "properties": {
                "assetName": "Bitcoin Punk #6042",
                "assetId": 6042,
                "projectName": "Bitcoin Punks",
                "seriesNumber": "unknown",
                "isOrdinal": true,
                "inscription": 6042,
                "inscriptionLink": "https://ordinals.com/inscription/ed7250807a75e755f6a57d9bf804776f97cdaa7aabb3",
                "risk": "high",
                "reasons": ["warning in title", "empty balance"]
            }
        },
        {
            "title": "Bitcoin Punk #3210 (Ordinal Inscription #32538)",
            "balances": [{"coin":"BTC","name":"Bitcoin","balance":0.0000796,"price":1.7712926319999998,"project":null,"projectLogo":null,"projectSite":null}],
            "properties": {
                "assetName": "Bitcoin Punk #6042",
                "assetId": 6042,
                "projectName": "Bitcoin Punks",
                "seriesNumber": "unknown",
                "isOrdinal": true,
                "inscription": 6042,
                "risk": "low",
                "reasons":[]
            }
        },
        {
            "title": "RAREPEPE",
            "balances": [{"coin":"ETH","name":"RAREPEPE","balance":1, type: "nft"}],
            "properties": {
                "projectName": "Rare Pepe",
                "risk": "high ⚠️",
                "reasons": ["enclosed asset is on incorrect chain"]
            }
        },
        {
            "title": "RPEPELIGHTER",
            "description": "Collection:RarePepes - Series#4 Card#38",
            "properties": {
                "assetName": "RPEPELIGHTER",
                "assetId": 38,
                "projectName": "Rare Pepe",
                "seriesNumber": 4,
                "isOrdinal": false,
                "inscription": "n/a",
                "risk": "low",
                "reasons":[]
            }
        },
        {
            "title": "PEPEONECOIN | Rare Pepe | Series 1 - Card 24",
            "description": "PEPEONECOIN | Rare Pepe | Series 1 - Card 24 http://rarepepedirectory.com/?p=137 https://xchain.io/asset/PEPEONECOIN",
            "properties": {
                "assetName": "PEPEONECOIN",
                "assetId": 24,
                "projectName": "Rare Pepe",
                "seriesNumber": 1,
                "isOrdinal": false,
                "inscription": "n/a",
                "risk": "low",
                "reasons":[]
            }
        },
        {
            "title": "HARVESTER | Age Of Chains 2017",
            "description": "HARVESTER, Card 9 created in 2017, from the project Age Of Chains. Total supply is 6,666.",
            "properties": {
                "assetName": "HARVESTER",
                "assetId": 9,
                "projectName": "Age Of Chains",
                "seriesNumber": "unknown",
                "isOrdinal": false,
                "inscription": "n/a",
                "risk": "low",
                "reasons":[]
            }
        },
        {
            "title": "id/helenyoung | 2014-07 | Namecoin Identity (id/ asset) |",
            "description": "Asset: id/helenyoung\n\nMint: Jul 21st, 2014\n\nThis vault contains a Namecoin Identity id/ asset. Launched in May 2012,",
            "properties": {
                "assetName": "id/helenyoung",
                "assetId": "n/a",
                "projectName": "Namecoin Identity",
                "seriesNumber": "n/a",
                "isOrdinal": false,
                "inscription": "n/a",
                "risk": "low",
                "reasons":[]
            }
        },
        {
            "description":"Below and at Emblem.Finance 👇",
            "balances": [],
            "properties":{
                "risk": "med",
                "reasons": ["copy paste description", "empty balance"]
            }
        }
    ]
}


