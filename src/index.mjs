import * as fs from 'fs';
import { mkdir, writeFile } from 'fs/promises';
import { Readable } from 'stream';
import { finished } from 'stream/promises';
import * as path from 'path';

import { request, gql } from 'graphql-request'

const query = gql`
{
    items {
        id
        name
        avg24hPrice
        historicalPrices {
            price
        }
    }
}
`

request('https://api.tarkov.dev/graphql', query).then((tarkovDevPrices) => {
// fs.readFile('tarkovdevprices.json', {encoding: 'utf-8'}, (err, tarkovDevPrices) => {
//     if (err != null) return;
//     tarkovDevPrices = JSON.parse(tarkovDevPrices);

    // Write the tarkovdev price so we have a place to look in the event of errors
    fs.writeFileSync('tarkovdevprices.json', JSON.stringify(tarkovDevPrices, null, 4));

    // Fetch the latest prices.json from SPT-AKI's git repo
    downloadFile('https://dev.sp-tarkov.com/SPT-AKI/Server/raw/branch/master/project/assets/database/templates/prices.json', 'akiprices.json').then(() => {
    //fs.readFile('akiprices.json', {encoding: 'utf-8'}, (err, _) => {
        const akiPrices = JSON.parse(fs.readFileSync('akiprices.json', 'utf-8'));
        const updatedPrices = JSON.parse(JSON.stringify(akiPrices));

        // Loop through the data retrieved from tarkov.dev, and update the aki price data if it's valid
        for (const price of tarkovDevPrices.items)
        {
            // If the price doesn't exist in the AKI data, skip
            if (!akiPrices[price.id]) continue;

            // If the price is 0, and has no historical data, skip
            if (price.avg24hPrice <= 0 && price.historicalPrices.length == 0) continue;

            // Update the price with either the 24-hour average, or latest historical price
            if (price.avg24hPrice > 0)
            {
                updatedPrices[price.id] = price.avg24hPrice;
            }
            else
            {
                updatedPrices[price.id] = price.historicalPrices.slice(-1).price;
            }
        }

        // Loop through the prices and check for any with a > 20% price difference and log it
        // for (const itemId in updatedPrices)
        // {
        //     const difference = (updatedPrices[itemId] / akiPrices[itemId]) - 1;
        //     if (Math.abs(difference) >= 0.2) {
        //         console.log(`Price different for ${itemId} was ${Math.round(difference * 100)}%  from ${akiPrices[itemId]} -> ${updatedPrices[itemId]}`);
        //     }
        // }

        // Write out the updated price data
        fs.writeFileSync('prices.json', JSON.stringify(updatedPrices, null, 4));
    });


});

const downloadFile = (async (url, filename) => {
  const res = await fetch(url);
  const fileStream = fs.createWriteStream(filename, { flags: 'w' });
  await finished(Readable.fromWeb(res.body).pipe(fileStream));
});
