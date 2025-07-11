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
        const endpoint = "https://api.tarkov.dev/graphql";
        const graphQLClient = new GraphQLClient(endpoint, {
            errorPolicy: "ignore"
        });
        
        // Fetch data from tarkov.dev
        await fetchTarkovDevData(graphQLClient, 'regular');
        await fetchTarkovDevData(graphQLClient, 'pve');

        // Fetch the latest prices.json and handbook.json from SPT's git repo
        await downloadFile('https://raw.githubusercontent.com/sp-tarkov/server/refs/heads/master/project/assets/database/templates/handbook.json', 'spthandbook.json');
        await downloadFile('https://raw.githubusercontent.com/sp-tarkov/server/refs/heads/master/project/assets/database/templates/prices.json', 'sptprices.json');
    }

    // Tarkov has disabled flea for this wipe for PvP, so don't update the prices
    // processData('regular');
    processData('pve');
});

const fetchTarkovDevData = (async (graphQLClient, gameMode) => {
    const query = gql`
    {
        items(lang: en, gameMode: ${gameMode}) {
            id
            name
            avg24hPrice
            changeLast48hPercent
        }
    }
    `
    const tarkovDevPrices = await graphQLClient.request(query);
    fs.writeFileSync(`tarkovdevprices-${gameMode}.json`, JSON.stringify(tarkovDevPrices, null, 4));
})

const processData = ((gameMode) => {
    // Read in data
    const tarkovDevPrices = JSON.parse(fs.readFileSync(`tarkovdevprices-${gameMode}.json`, 'utf-8'));
    const sptHandbook = JSON.parse(fs.readFileSync('spthandbook.json', 'utf-8'));
    const sptItems = JSON.parse(fs.readFileSync('items.json', 'utf-8'));
    const sptPrices = JSON.parse(fs.readFileSync('sptprices.json', 'utf-8'));

    // Start with a base of the SPT price list
    const priceList = structuredClone(sptPrices);

    // Filter tarkov.dev prices in the same way SPT does
    const filteredTarkovDevPrices = processTarkovDevPrices(gameMode, tarkovDevPrices);

    // Get a price for each item in the items list
    for (const itemId in filteredTarkovDevPrices)
    {
        // Skip items that aren't in SPTs item database, this tends to be presets
        if (!sptItems[itemId])
        {
            continue;
        }

        const itemPrice = filteredTarkovDevPrices[itemId];
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

const processTarkovDevPrices = ((gameMode, tarkovDevPrices) => {
    const filteredTarkovDevPrices = {};

    for (const item of tarkovDevPrices.items)
    {
        if (item.changeLast48hPercent > 100)
        {
            console.warn(`[${gameMode}] Item ${item.id} ${item.name} Has had recent ${item.changeLast48hPercent}% increase in price`);
        }

        if (item.name.indexOf(" (0/") >= 0)
        {
            if (DEBUG) console.warn(`[${gameMode}] Skipping 0 durability item: ${item.id} ${item.name}`);
            continue;
        }

        filteredTarkovDevPrices[item.id] = {
            Name: item.name,
            Average24hPrice: item.avg24hPrice,
            TemplateId: item.id
        };
    }

    return filteredTarkovDevPrices;
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
