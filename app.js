let deployManifest = require("./manifest.json");
let ncp = require("ncp").ncp;
let replaceStream = require('replacestream');
const util = require('util');
const exec = util.promisify(require('child_process').exec);
let async = require('async');
const fs = require("fs");
const fsp = fs.promises;
const mongoose = require("mongoose");
const tunnel = require("tunnel-ssh");
const path = require('path');

let sshConfig = {
    username:'alonzo',
    host:'dev.aetheria.io',
    agent: process.env.SSH_AUTH_SOCK,
    privateKey:require('fs').readFileSync('~/.ssh/Aetheria.pri'),
    dstHost:'127.0.0.1',
    dstPort:27017,
    localHost:'127.0.0.1',
    localPort: 27017
}

let mongoConfig = {
    host: 'localhost',
    dbName: 'AllocationEvent',
    port: 27017
}
function copyTemplate(x,y)
{
   return new Promise((res,rej)=>{
       ncp("./template/", `./tmp/${x},${y}/`, (err)=>{
            if (err) {rej(err)};
           ncp("./template/scene.json", `./tmp/${x},${y}/scene.json`, {transform: applyStreamingTemplates({'x':x,'y':y})}, (err) => {
               if (err) {rej(err)}
               res();
           })
        })
    });
}

function runStringTemplate(template_string, params)
{
    var tmp = template_string;
    for(let prop in params) {
        var tmp = tmp.replace(`%${prop}`, params[prop]);
    }
    return tmp;
}

async function deployScene (dir)
{
    const { stdout, stderr } = await exec(`dcl deploy`, {
        "cwd": dir
    });
    if (stderr) {console.error(stderr);}
    if (stdout) {console.log(stdout);}
    await exec(`rm -rf ${dir}`);
}

function applyStreamingTemplates (params)
{
    return function (read, write) {
        var tmp = read;
        for (let prop in params) {
            tmp = tmp.pipe(replaceStream(`%${prop}`,params[prop]));
        }
        tmp.pipe(write);
    }
}

async function buildNewScene (x, y, modelPath)
{
    let templatedModelPath = runStringTemplate(modelPath, {X:x,Y:y});

    await copyTemplate(x, y);
    console.log(`Copyed ${x},${y}`);
    if (templatedModelPath) {
        await fsp.copyFile(templatedModelPath, `./tmp/${x},${y}/models/SCENE.glb`)
    }
}

async function getPlotList ()
{
    let fileObjects = await fsp.readdir(deployManifest.modelPath, {withFileTypes: true});
    let files = fileObjects.map(x => x.name);

    let cordExtract = (str) => { // limits files to have x and y as the only numbers. Could be replaced with matching on the template
        let matches = str.match(/\d+/g);
        let castedMatches = matches.map(numStr => parseInt(numStr)); // Truthyness bug causes map(parseInt) to break
        if (matches.length != 2) {throw Error("Models directory is poluted!")};
        return {x: castedMatches[0], y: castedMatches[1]};
    }

    let cordList = files.map(cordExtract);
    return cordList;
}
//x=150, y=144, y=74, y=59
function getAetheriaPlotList()
{
    let tmp = []
    for(y = 150; y > 58; y--)
        {
            tmp.push({x: 150, y: y});
        }

    for(x = 62; x < 151; x++)
        {
            tmp.push({x: x, y: 144});
            tmp.push({x: x, y: 74});
            tmp.push({x: x, y: 59});
        }
    for(x = 62; x < 150; x++)
    {
        for(y = 150; y > 144; y--)
        {
            tmp.push({x: x, y: y});
        }
    }

    for(x = 62; x < 150; x++)
    {
        for(y = 143; y > 74; y--)
        {
            tmp.push({x: x, y: y});
        }
    }

    for (x = 74; x < 150; x++)
    {
        for(y = 73; y > 59; y--)
            {
                tmp.push({x: x, y: y});
            }
    }
    return tmp
}

async function getFlaggedPlots (db)
{
    return (await db.collection("Claimed").find({}).toArray()).map(x => x.cords)
}

async function main (db)
{
    if(!process.env.DCL_PRIVATE_KEY) {console.error("No enviroment variable DCL_PRIVATE_KEY set!"); return;}
    let completeModelPath = deployManifest.modelPath + deployManifest.modelFile;
    let claimList = await getFlaggedPlots(db);
    let plotList = getAetheriaPlotList();
    claimList.forEach((claim) => {
        plotList = plotList.filter((plot) => {
            return !(plot.x == claim.x && plot.y == claim.y)
        })
    })
    let deployQueue = async.queue(async (plotCord) => {
        let x = plotCord.x;
        let y = plotCord.y;
        let path = `./tmp/${x},${y}/`;

        await buildNewScene(plotCord.x, plotCord.y, completeModelPath);
        await deployScene(path);
    }, deployManifest.concurrency);
    plotList.forEach(plotCord => {
        deployQueue.push(plotCord);
    });
}

process.on('unhandledRejection', (reason, p) => {
  console.log('Unhandled Rejection at: Promise', p, 'reason:', reason);
});

let server = tunnel(sshConfig, (error, server) => {
    mongoose.connect(`mongodb://${mongoConfig.host}:${mongoConfig.port}/${mongoConfig.dbName}`);

    var db = mongoose.connection;
    db.on('error', console.error.bind(console, 'DB connection error:'));
    db.once('open', async () => {
        await main(db);
    });
});
