import * as fs from 'fs';
import { Readable } from 'stream';
import { finished } from 'stream/promises';
import { gql, GraphQLClient } from 'graphql-request'

/**
 * Configuration
 */
const DEBUG = false;

const main = (async () => {
    // Fetch data
    if (!DEBUG)
    {
        const jsonEndpoint = "https://json.tarkov.dev";
        const endpoint = "https://api.tarkov.dev/graphql";
        const graphQLClient = new GraphQLClient(endpoint, {
            errorPolicy: "ignore"
        });
        
        // Fetch data from tarkov.dev
        await downloadFile('https://json.tarkov.dev/pve/items', `tarkovdevitems-pve.json`);
        await downloadFile('https://json.tarkov.dev/regular/items', `tarkovdevitems-regular.json`);
        await downloadFile('https://json.tarkov.dev/regular/items_en', 'tarkovdevitems-names.json');

        // Fetch the latest prices.json and handbook.json from SPT's git repo
        await downloadFile('https://raw.githubusercontent.com/sp-tarkov/server-csharp/refs/heads/main/Libraries/SPTarkov.Server.Assets/SPT_Data/database/templates/handbook.json', 'spthandbook.json');
        await downloadFile('https://raw.githubusercontent.com/sp-tarkov/server-csharp/refs/heads/main/Libraries/SPTarkov.Server.Assets/SPT_Data/database/templates/prices.json', 'sptprices.json');
    }

    // PvP prices are fucked, but users want them anyways, good luck
    processData('regular');
    processData('pve');
});

const processData = ((gameMode) => {
    // Read in data
    const tarkovDevItems = JSON.parse(fs.readFileSync(`tarkovdevitems-${gameMode}.json`, 'utf-8'))['data'];
    const tarkovDevNames = JSON.parse(fs.readFileSync(`tarkovdevitems-names.json`, 'utf-8'))['data'];
    const sptHandbook = JSON.parse(fs.readFileSync('spthandbook.json', 'utf-8'));
    const sptItems = JSON.parse(fs.readFileSync('items.json', 'utf-8'));
    const sptPrices = JSON.parse(fs.readFileSync('sptprices.json', 'utf-8'));

    // Start with a base of the SPT price list
    const priceList = structuredClone(sptPrices);

    // Filter tarkov.dev prices in the same way SPT does
    const filteredTarkovDevItems = processTarkovDevItems(gameMode, tarkovDevItems, tarkovDevNames);

    // Get a price for each item in the items list
    for (const itemId in filteredTarkovDevItems)
    {
        // Skip items that aren't in SPTs item database, this tends to be presets
        if (!sptItems[itemId])
        {
            continue;
        }

        const itemPrice = filteredTarkovDevItems[itemId];
        if (itemPrice.Average24hPrice)
        {
            if (DEBUG) console.log(`[${gameMode}] Adding item: ${itemPrice.TemplateId} ${itemPrice.Name} -> ${itemPrice.Average24hPrice}`);
            priceList[itemId] = itemPrice.Average24hPrice;
        }
    }

    // Ammo packs are easy to exploit, they're never listed on flea which causes server to use handbook price, often contain ammo worth x100 the cost of handbook price
    const ammoPacks = Object.values(sptItems)
    .filter(x => (x._parent === "5661632d4bdc2d903d8b456b" || x._parent === "543be5cb4bdc2deb348b4568")
        && (x._name.includes("item_ammo_box_") || x._name.includes("ammo_box_"))
        && !x._name.includes("_damaged"));

    for (const ammoPack of ammoPacks)
    {
        if (!priceList[ammoPack._id])
        {
            if (DEBUG) console.info(`[${gameMode}] edge case ammo pack ${ammoPack._id} ${ammoPack._name} not found in prices, adding manually`);
            // get price of item to multiply price of
            const itemMultipler = ammoPack._props.StackSlots[0]._max_count;
            const singleItemPrice = getItemPrice(priceList, sptHandbook.Items, ammoPack._props.StackSlots[0]._props.filters[0].Filter[0]);
            const price = singleItemPrice * itemMultipler;

            priceList[ammoPack._id] = price;

        }
    }

    // Write out the updated price data
    fs.writeFileSync(`prices-${gameMode}.json`, JSON.stringify(priceList, null, 4));
});

const processTarkovDevItems = ((gameMode, tarkovDevItems, tarkovDevNames) => {
    const filteredTarkovDevItems = {};

    for (const item of Object.values(tarkovDevItems.items))
    {
        const itemName = tarkovDevNames[item.name] || item.normalizedName;
        if (item.changeLast48hPercent > 100)
        {
            console.warn(`[${gameMode}] Item ${item.id} ${itemName} Has had recent ${item.changeLast48hPercent}% increase in price`);
        }

        filteredTarkovDevItems[item.id] = {
            Name: itemName,
            Average24hPrice: item.avg24hPrice,
            TemplateId: item.id
        };
    }

    return filteredTarkovDevItems;
});

const getItemPrice = ((priceList, handbookItems, itemTpl) => {
    const fleaPrice = priceList[itemTpl];
    if (!fleaPrice)
    {
        return handbookItems.find(x => x.Id === itemTpl).Price;
    }
    return fleaPrice;
});

const downloadFile = (async (url, filename) => {
  const res = await fetch(url);
  const fileStream = fs.createWriteStream(filename, { flags: 'w' });
  await finished(Readable.fromWeb(res.body).pipe(fileStream));
});

// Trigger main
await main();
