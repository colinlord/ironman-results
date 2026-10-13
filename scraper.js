const fs = require("fs/promises");
const path = require("path");
const readline = require("readline");

/**
 * Creates a readline interface and returns a helper function
 * to ask questions as a Promise.
 */
function createQuestionInterface() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return {
    ask: (query) => new Promise((resolve) => rl.question(query, resolve)),
    close: () => rl.close(),
  };
}

/**
 * Fetches the HTML from a URL.
 */
async function fetchHtml(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/100.0.4896.127 Safari/537.36",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch URL. Status: ${response.status}`);
  }

  return response.text();
}

/**
 * Maps any page within an ironman.com race (e.g. ".../races/im703-augusta/"
 * or ".../races/im703-augusta/schedule") to that race's results page.
 * Requests the race's home page first so redirects from older or alias
 * links (e.g. "ironman.com/im703-augusta" or
 * ".../races/im703-world-championship") land on the current race URL.
 * Other URLs are returned unchanged.
 */
async function getResultsPageUrl(url) {
  const racePath = /^\/races\/([^\/]+)/i;

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }

  if (!/(^|\.)ironman\.com$/i.test(parsed.hostname)) {
    return url;
  }

  const match = parsed.pathname.match(racePath);
  const raceHomeUrl = match ? `${parsed.origin}/races/${match[1]}` : url;

  const response = await fetch(raceHomeUrl, {
    method: "HEAD",
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/100.0.4896.127 Safari/537.36",
    },
  });
  if (!response.ok) {
    return url;
  }

  const finalUrl = new URL(response.url);
  const finalMatch = finalUrl.pathname.match(racePath);
  if (!finalMatch) {
    return url;
  }

  return `${finalUrl.origin}/races/${finalMatch[1]}/results`;
}

/**
 * Finds the competitor.com results iframe embedded in an ironman.com
 * results page. Skips the other embeds (e.g. ".../results/event/odiv/..."
 * and ".../clubpoints/...").
 */
function findResultsIframeUrl(htmlContent) {
  const regex =
    /<iframe[^>]*\ssrc="(https:\/\/labs-v2\.competitor\.com\/results\/event\/[^"\/]+)"/i;
  const match = htmlContent.match(regex);
  return match ? match[1].replace(/&amp;/g, "&") : null;
}

/**
 * Fetches the HTML from the Group URL and extracts the __NEXT_DATA__ blob.
 * Accepts either the labs-v2.competitor.com event group URL or an
 * ironman.com results page that embeds it in an iframe.
 */
async function fetchNextData(url) {
  console.log(`Fetching main event group data from: ${url}`);

  let htmlContent = await fetchHtml(url);
  const regex =
    /<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/s;
  let match = htmlContent.match(regex);

  if (!match) {
    const iframeUrl = findResultsIframeUrl(htmlContent);
    if (iframeUrl) {
      console.log(`Found embedded results page: ${iframeUrl}`);
      htmlContent = await fetchHtml(iframeUrl);
      match = htmlContent.match(regex);
    }
  }

  if (!match || !match[1]) {
    throw new Error(
      "Could not find __NEXT_DATA__ script tag in the fetched HTML. " +
        "Use a page from an ironman.com race (e.g. " +
        "https://www.ironman.com/races/im703-augusta) or the " +
        "labs-v2.competitor.com event group URL."
    );
  }

  console.log("Found JSON data. Parsing...");
  return JSON.parse(match[1]);
}

/**
 * Fetches the results JSON for a specific event UUID from the API.
 * Open Division (ODIV) athletes are only returned when asked for by age
 * group, so they're fetched separately and added to the end.
 */
async function fetchResultsForEvent(eventUuid) {
  const API_URL = `https://labs-v2.competitor.com/api/results?wtc_eventid=${eventUuid}`;
  console.log(`Fetching results from API for event: ${eventUuid}`);

  const results = await fetchResultsFromApi(API_URL);
  const odivResults = await fetchResultsFromApi(`${API_URL}&agegroup=ODIV`);

  const resultIds = new Set(results.map((r) => r.wtc_resultid));
  return [
    ...results,
    ...odivResults.filter((r) => !resultIds.has(r.wtc_resultid)),
  ];
}

/**
 * Fetches one results API URL and returns its list of results.
 */
async function fetchResultsFromApi(API_URL) {
  const response = await fetch(API_URL, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/100.0.4896.127 Safari/537.36",
      Accept: "application/json",
    },
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

// The rank IRONMAN gives athletes who aren't ranked (non-finishers, ODIV, etc.).
const UNRANKED = 99999;

/**
 * Tidies the whitespace in a free-text profile field: trims the ends and
 * turns line breaks and repeated spaces into a single space. Every other
 * character is left exactly as IRONMAN has it.
 */
function cleanWhitespace(value) {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

/**
 * Returns the athlete's gender. Uses the division's gender, which is what
 * IRONMAN's gender ranks use (the profile gender is sometimes missing or
 * contradicts it), falling back to the profile gender for divisions that
 * don't have one (e.g. PC, HC, ODIV).
 */
function getGender(r) {
  return (
    r.wtc_AgeGroupId?.wtc_gender_formatted ||
    r.wtc_ContactId?.gendercode_formatted ||
    ""
  );
}

/**
 * Ranks athletes by one leg's time alone (fastest = 1), overall and within
 * each gender and division. Athletes with the same time share a rank
 * (1, 2, 2, 4). Athletes outside the pool or without a time for the leg
 * get UNRANKED, the same as in IRONMAN's own rank fields.
 */
function computeSplitRanks(data, getTime, isRanked) {
  const ranks = new Map(
    data.map((r) => [
      r,
      { overall: UNRANKED, gender: UNRANKED, division: UNRANKED },
    ])
  );
  const groupBy = {
    overall: () => "all",
    gender: getGender,
    division: (r) => r.wtc_AgeGroupId?.wtc_agegroupname,
  };
  const pool = data.filter((r) => isRanked(r) && getTime(r) > 0);

  for (const [scope, getGroup] of Object.entries(groupBy)) {
    const groups = new Map();
    for (const r of pool) {
      const group = getGroup(r);
      if (!group) continue;
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group).push(r);
    }

    for (const members of groups.values()) {
      members.sort((a, b) => getTime(a) - getTime(b));
      members.forEach((r, i) => {
        const prev = members[i - 1];
        ranks.get(r)[scope] =
          prev && getTime(prev) === getTime(r) ? ranks.get(prev)[scope] : i + 1;
      });
    }
  }

  return ranks;
}

/**
 * Converts the array of results (from the API) into a CSV string.
 * --- UPDATED HEADERS ---
 */
function convertToCSV(data) {
  // Older events (e.g. 2006, 2009) have no overall or gender ranks: they're
  // UNRANKED for everyone, and the division ("group") ranks hold each
  // athlete's overall place instead.
  const legacyRanks =
    !data.some((r) => Number(r.wtc_finishrankoverall) < UNRANKED) &&
    data.some((r) => Number(r.wtc_finishrankgroup) < UNRANKED);

  // Like IRONMAN's own swim rank, split ranks only include athletes
  // IRONMAN ranked at the finish.
  const isRanked = (r) =>
    Number(legacyRanks ? r.wtc_finishrankgroup : r.wtc_finishrankoverall) <
    UNRANKED;
  const bikeSplitRanks = computeSplitRanks(data, (r) => r.wtc_biketime, isRanked);
  const runSplitRanks = computeSplitRanks(data, (r) => r.wtc_runtime, isRanked);

  // Transitions are only ranked if the race had them: e.g. there's no T1
  // when the swim is canceled, so everyone's T1 time is 0. A transition
  // counts as missing when most ranked athletes have no time for it, and
  // its ranks are left empty.
  const rankedAthletes = data.filter(isRanked);
  const rankTransition = (getTime) =>
    rankedAthletes.filter((r) => getTime(r) > 0).length >
    rankedAthletes.length / 2
      ? computeSplitRanks(data, getTime, isRanked)
      : null;
  const t1SplitRanks = rankTransition((r) => r.wtc_transition1time);
  const t2SplitRanks = rankTransition((r) => r.wtc_transition2time);
  const noRanks = { overall: "", gender: "", division: "" };

  // 1. Updated Headers
  const headers = [
    "Bib Number",
    "Athlete Name",
    "Gender",
    "City",
    "State",
    "Country of Residence",
    "Country Represented",
    "Division",
    "Status",
    "Finish Time",
    "Swim Time",
    "T1 Time",
    "Bike Time",
    "T2 Time",
    "Run Time",
    "Overall Rank",
    "Gender Rank",
    "Division Rank",
    "AWA Points",
    "Swim Rank (Overall)",
    "Swim Rank (Gender)",
    "Swim Rank (Division)",
    "T1 Split Rank (Overall)",
    "T1 Split Rank (Gender)",
    "T1 Split Rank (Division)",
    "Bike Split Rank (Overall)",
    "Bike Split Rank (Gender)",
    "Bike Split Rank (Division)",
    "Position After Bike (Overall)",
    "Position After Bike (Gender)",
    "Position After Bike (Division)",
    "T2 Split Rank (Overall)",
    "T2 Split Rank (Gender)",
    "T2 Split Rank (Division)",
    "Run Split Rank (Overall)",
    "Run Split Rank (Gender)",
    "Run Split Rank (Division)",
    "Finish (Seconds)",
    "Swim (Seconds)",
    "T1 (Seconds)",
    "Bike (Seconds)",
    "T2 (Seconds)",
    "Run (Seconds)",
  ];

  // 2. Map data explicitly to those updated headers
  const rows = data.map((r) => {
    const t1SplitRank = t1SplitRanks?.get(r) ?? noRanks;
    const bikeSplitRank = bikeSplitRanks.get(r);
    const t2SplitRank = t2SplitRanks?.get(r) ?? noRanks;
    const runSplitRank = runSplitRanks.get(r);

    return {
      "Bib Number": r.bib,
      "Athlete Name": cleanWhitespace(r.athlete),
      Gender: getGender(r),
      City: cleanWhitespace(r.wtc_ContactId?.address1_city),
      State: cleanWhitespace(r.wtc_ContactId?.address1_stateorprovince),
      // Exactly as IRONMAN has it; athletes enter it in many formats
      // (e.g. "US", "usa", "United States").
      "Country of Residence": r.wtc_ContactId?.address1_country,
      // The country the athlete races for, which can differ from where
      // they live.
      "Country Represented": r.countryiso2,
      Division:
        r.wtc_AgeGroupId?.wtc_agegroupname || r.wtc_DivisionId?.wtc_name || "",
      // NC = not classified: no flag set and not an official finisher,
      // e.g. finished outside the time cutoffs.
      Status: r.wtc_dq
        ? "DQ"
        : r.wtc_dns
        ? "DNS"
        : r.wtc_dnf
        ? "DNF"
        : r.wtc_finisher
        ? "FIN"
        : "NC",

      "Finish Time": r.wtc_finishtimeformatted,
      "Swim Time": r.wtc_swimtimeformatted,
      "T1 Time": r.wtc_transition1timeformatted,
      "Bike Time": r.wtc_biketimeformatted,
      "T2 Time": r.wtc_transitiontime2formatted,
      "Run Time": r.wtc_runtimeformatted,

      "Overall Rank": legacyRanks
        ? r.wtc_finishrankgroup
        : r.wtc_finishrankoverall,
      "Gender Rank": r.wtc_finishrankgender,
      "Division Rank": legacyRanks ? UNRANKED : r.wtc_finishrankgroup,
      "AWA Points": r.wtc_points,

      "Swim Rank (Overall)": legacyRanks
        ? r.wtc_swimrankgroup
        : r.wtc_swimrankoverall,
      "Swim Rank (Gender)": r.wtc_swimrankgender,
      "Swim Rank (Division)": legacyRanks ? UNRANKED : r.wtc_swimrankgroup,

      "T1 Split Rank (Overall)": t1SplitRank.overall,
      "T1 Split Rank (Gender)": t1SplitRank.gender,
      "T1 Split Rank (Division)": t1SplitRank.division,

      "Bike Split Rank (Overall)": bikeSplitRank.overall,
      "Bike Split Rank (Gender)": bikeSplitRank.gender,
      "Bike Split Rank (Division)": bikeSplitRank.division,

      // IRONMAN's "bike rank" is the athlete's place in the race at the end
      // of the bike (swim + T1 + bike), not a rank of the bike leg alone.
      "Position After Bike (Overall)": legacyRanks
        ? r.wtc_bikerankgroup
        : r.wtc_bikerankoverall,
      "Position After Bike (Gender)": r.wtc_bikerankgender,
      "Position After Bike (Division)": legacyRanks
        ? UNRANKED
        : r.wtc_bikerankgroup,

      "T2 Split Rank (Overall)": t2SplitRank.overall,
      "T2 Split Rank (Gender)": t2SplitRank.gender,
      "T2 Split Rank (Division)": t2SplitRank.division,

      // IRONMAN's "run rank" is just the finish rank, so it's not repeated.
      "Run Split Rank (Overall)": runSplitRank.overall,
      "Run Split Rank (Gender)": runSplitRank.gender,
      "Run Split Rank (Division)": runSplitRank.division,

      "Finish (Seconds)": r.wtc_finishtime,
      "Swim (Seconds)": r.wtc_swimtime,
      "T1 (Seconds)": r.wtc_transition1time,
      "Bike (Seconds)": r.wtc_biketime,
      "T2 (Seconds)": r.wtc_transition2time,
      "Run (Seconds)": r.wtc_runtime,
    };
  });

  const headerRow = headers.join(",");

  const dataRows = rows.map((row) => {
    return headers
      .map((header) => {
        // Keep IRONMAN's 0 values (e.g. 0 AWA points, 0 seconds for a
        // leg with no time); only missing values become empty.
        let value = String(row[header] ?? "");
        value = value.replace(/"/g, '""');
        return `"${value}"`;
      })
      .join(",");
  });

  return [headerRow, ...dataRows].join("\n");
}

/**
 * Extracts a 4-digit year from a string.
 */
function getYearFromName(eventName) {
  if (!eventName) return null;
  const match = eventName.match(/\b(20\d{2})\b/);
  return match ? match[1] : null;
}

/**
 * Builds a filename suffix to tell apart events that share a year
 * (e.g. separate Women's and Men's World Championship races).
 */
function getEventSuffix(eventName) {
  if (!eventName) return "event";
  if (/\bwomen\b/i.test(eventName)) return "women";
  if (/\bmen\b/i.test(eventName)) return "men";
  const slug = eventName
    .replace(/\b20\d{2}\b/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return slug || "event";
}

/**
 * Main function to run the script
 */
(async () => {
  const io = createQuestionInterface();

  try {
    const eventUrl = (await io.ask("Please paste the race URL: ")).trim();
    if (!eventUrl.startsWith("http")) {
      throw new Error("Invalid URL.");
    }

    let eventNameBase = await io.ask(
      "Enter a base name for the event (e.g., chattanooga): "
    );
    eventNameBase = eventNameBase
      .toLowerCase()
      .replace(/\s+/g, "_")
      .replace(/[^a-z0-9_]/g, "");

    const jsonData = await fetchNextData(await getResultsPageUrl(eventUrl));
    const pageProps = jsonData?.props?.pageProps;

    const subEvents = pageProps?.subevents;

    if (!subEvents || subEvents.length === 0) {
      throw new Error(
        'Could not find "subevents" in the JSON data. Cannot find list of events.'
      );
    }

    console.log(`Found ${subEvents.length} total events.`);

    const events = [];
    for (const event of subEvents) {
      const eventUuid = event.wtc_eventid;
      const eventYear = getYearFromName(
        event.wtc_name || event.wtc_externaleventname
      );

      if (!eventUuid || !eventYear) {
        console.log(
          `Found an event with missing uuid or year. Skipping. (Name: ${event.wtc_name})`
        );
        continue;
      }

      events.push({ eventUuid, eventYear, eventName: event.wtc_name });
    }

    // Only add a suffix when more than one event shares a year, so
    // single-race events keep the plain "<base>_<year>.csv" name.
    const eventsPerYear = {};
    for (const { eventYear } of events) {
      eventsPerYear[eventYear] = (eventsPerYear[eventYear] || 0) + 1;
    }

    const usedFiles = new Set();
    for (const event of events) {
      let fileBase = `${eventNameBase}_${event.eventYear}`;
      if (eventsPerYear[event.eventYear] > 1) {
        fileBase += `_${getEventSuffix(event.eventName)}`;
      }

      let outputFile = `${fileBase}.csv`;
      for (let n = 2; usedFiles.has(outputFile); n++) {
        outputFile = `${fileBase}_${n}.csv`;
      }
      usedFiles.add(outputFile);
      event.outputFile = outputFile;
    }

    const years = [...new Set(events.map((e) => e.eventYear))].sort(
      (a, b) => b - a
    );
    console.log(`Available years: ${years.join(", ")}`);

    const yearChoice = (
      await io.ask("Enter a year, 'latest', or press Enter for all years: ")
    )
      .trim()
      .toLowerCase();

    const latestOnly = yearChoice === "latest";
    let selectedEvents = events;
    if (latestOnly) {
      // Newest first, so we can stop after the first year that has results
      // (this year's race may be listed before it has been run).
      selectedEvents = [...events].sort((a, b) => b.eventYear - a.eventYear);
    } else if (yearChoice !== "" && yearChoice !== "all") {
      if (!years.includes(yearChoice)) {
        throw new Error(
          `No events found for "${yearChoice}". Available years: ${years.join(", ")}`
        );
      }
      selectedEvents = events.filter((e) => e.eventYear === yearChoice);
    }

    // With "latest", the newest year that has results or whose request
    // failed. A failed request doesn't fall back to an older year, since
    // that year may well have results.
    let latestYear = null;
    for (const { eventUuid, eventYear, eventName, outputFile } of selectedEvents) {
      if (latestOnly && latestYear && eventYear !== latestYear) {
        break;
      }

      const eventLabel = eventName || eventYear;
      console.log(`--- Processing Event: ${eventLabel} ---`);

      try {
        const resultsData = await fetchResultsForEvent(eventUuid);

        if (!resultsData || resultsData.length === 0) {
          console.log(`No results found for ${eventLabel}. Skipping.`);
          continue;
        }

        const csvData = convertToCSV(resultsData);

        // Start with a UTF-8 byte order mark so Excel reads accented names
        // correctly instead of garbling them.
        await fs.writeFile(outputFile, "\uFEFF" + csvData);
        latestYear = eventYear;
        console.log(
          `✅ Successfully saved ${resultsData.length} results to ${outputFile}`
        );
      } catch (apiError) {
        latestYear = eventYear;
        console.error(
          `Failed to process ${eventLabel} (UUID: ${eventUuid}). Error: ${apiError.message}`
        );
      }
    }

    if (latestOnly && !latestYear) {
      console.log("No results found for any year.");
    }
  } catch (error) {
    console.error("An error occurred:", error.message);
  } finally {
    io.close();
  }
})();
