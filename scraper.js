const fs = require('fs/promises');
const path = require('path');
const readline = require('readline');

/**
 * Creates a readline interface and returns a helper function
 * to ask questions as a Promise.
 */
function createQuestionInterface() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return {
    ask: (query) => new Promise(resolve => rl.question(query, resolve)),
    close: () => rl.close()
  };
}

/**
 * Fetches the HTML from the Group URL and extracts the __NEXT_DATA__ blob.
 */
async function fetchNextData(url) {
  console.log(`Fetching main event group data from: ${url}`);

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/100.0.4896.127 Safari/537.36'
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch URL. Status: ${response.status}`);
  }

  const htmlContent = await response.text();
  const regex = /<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/s;
  const match = htmlContent.match(regex);

  if (!match || !match[1]) {
    throw new Error('Could not find __NEXT_DATA__ script tag in the fetched HTML.');
  }

  console.log('Found JSON data. Parsing...');
  return JSON.parse(match[1]);
}

/**
 * Fetches the results JSON for a specific event UUID from the API.
 */
async function fetchResultsForEvent(eventUuid) {
  const API_URL = `https://labs-v2.competitor.com/api/results?wtc_eventid=${eventUuid}`;
  console.log(`Fetching results from API for event: ${eventUuid}`);

  const response = await fetch(API_URL, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/100.0.4896.127 Safari/537.36',
      'Accept': 'application/json'
    }
  });

  if (!response.ok) {
    throw new Error(`API request failed with status: ${response.status}`);
  }

  const data = await response.json();

  if (data && data.resultsJson && data.resultsJson.value) {
    return data.resultsJson.value;
  }

  throw new Error('API response did not contain "resultsJson.value".');
}

/**
 * Converts the array of results (from the API) into a CSV string.
 */
function convertToCSV(data) {
  const headers = [
    'Bib', 'Name', 'Gender', 'City', 'State', 'Country', 'AgeGroup', 'Status',
    'FinishTime', 'Swim', 'T1', 'Bike', 'T2', 'Run',
    'OverallRank', 'GenderRank', 'DivRank', 'Points',
    'SwimOvrRank', 'SwimGenRank', 'SwimDivRank',
    'BikeOvrRank', 'BikeGenRank', 'BikeDivRank',
    'RunOvrRank', 'RunGenRank', 'RunDivRank',
    'FinishTimeSec', 'SwimTimeSec', 'T1TimeSec', 'BikeTimeSec', 'T2TimeSec', 'RunTimeSec'
  ];

  const rows = data.map(r => {
    return {
      bib: r.bib,
      name: r.athlete,
      gender: r.wtc_ContactId?.gendercode_formatted || '',
      city: r.wtc_ContactId?.address1_city || '',
      state: r.wtc_ContactId?.address1_stateorprovince || '',
      country: r.countryiso2,
      agegroup: r.wtc_AgeGroupId?.wtc_agegroupname || r.wtc_DivisionId?.wtc_name || '',
      status: r.wtc_dnf ? 'DNF' : (r.wtc_dq ? 'DQ' : 'FIN'),
      finishtime: r.wtc_finishtimeformatted,
      swim: r.wtc_swimtimeformatted,
      t1: r.wtc_transition1timeformatted,
      bike: r.wtc_biketimeformatted,
      t2: r.wtc_transitiontime2formatted,
      run: r.wtc_runtimeformatted,
      overallrank: r.wtc_finishrankoverall,
      genderrank: r.wtc_finishrankgender,
      divrank: r.wtc_finishrankgroup,
      points: r.wtc_points,
      swimovrrank: r.wtc_swimrankoverall,
      swimgenrank: r.wtc_swimrankgender,
      swimdivrank: r.wtc_swimrankgroup,
      bikeovrrank: r.wtc_bikerankoverall,
      bikegenrank: r.wtc_bikerankgender,
      bikedivrank: r.wtc_bikerankgroup,
      runovrrank: r.wtc_runrankoverall,
      rungenrank: r.wtc_runrankgender,
      rundivrank: r.wtc_runrankgroup,
      finishtimesec: r.wtc_finishtime,
      swimtimesec: r.wtc_swimtime,
      t1timesec: r.wtc_transition1time,
      biketimesec: r.wtc_biketime,
      t2timesec: r.wtc_transition2time,
      runtimesec: r.wtc_runtime
    };
  });

  const headerRow = headers.join(',');
  const dataRows = rows.map(row => {
    return headers.map(headerKey => {
      let value = String(row[headerKey.toLowerCase()] || '');
      value = value.replace(/"/g, '""');
      return `"${value}"`;
    }).join(',');
  });

  return [headerRow, ...dataRows].join('\n');
}

/**
 * Extracts a 4-digit year from a string.
 */
function getYearFromName(eventName) {
  if (!eventName) return null;
  const match = eventName.match(/\b(20\d{2})\b/); // Finds a 4-digit number starting with "20"
  return match ? match[1] : null;
}

/**
 * Main function to run the script
 */
(async () => {
  const io = createQuestionInterface();

  try {
    const eventUrl = await io.ask('Please paste the main event group URL: ');
    if (!eventUrl.startsWith('http')) {
      throw new Error('Invalid URL.');
    }

    // --- THIS IS THE NEW PROMPT ---
    let eventNameBase = await io.ask('Enter a base name for the event (e.g., louisville): ');
    // Clean up the name (remove spaces, make lowercase)
    eventNameBase = eventNameBase.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');

    const jsonData = await fetchNextData(eventUrl);
    const pageProps = jsonData?.props?.pageProps;

    const subEvents = pageProps?.subevents;

    if (!subEvents || subEvents.length === 0) {
      throw new Error('Could not find "subevents" in the JSON data. Cannot find list of events.');
    }

    console.log(`Found ${subEvents.length} total events to scrape.`);

    for (const event of subEvents) {
      const eventUuid = event.wtc_eventid;
      const eventYear = getYearFromName(event.wtc_name || event.wtc_externaleventname);

      if (!eventUuid || !eventYear) {
        console.log(`Found an event with missing uuid or year. Skipping. (Name: ${event.wtc_name})`);
        continue;
      }

      console.log(`--- Processing Event: ${eventYear} ---`);

      try {
        const resultsData = await fetchResultsForEvent(eventUuid);

        if (!resultsData || resultsData.length === 0) {
          console.log(`No results found for ${eventYear}. Skipping.`);
          continue;
        }

        const csvData = convertToCSV(resultsData);

        // --- THIS IS THE NEW FILENAME LOGIC ---
        const outputFile = `${eventNameBase}_${eventYear}.csv`;

        await fs.writeFile(outputFile, csvData);
        console.log(`✅ Successfully saved ${resultsData.length} results to ${outputFile}`);

      } catch (apiError) {
        console.error(`Failed to process ${eventYear} (UUID: ${eventUuid}). Error: ${apiError.message}`);
      }
    }

  } catch (error) {
    console.error('An error occurred:', error.message);
  } finally {
    io.close();
  }
})();
