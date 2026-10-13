# Ironman / Competitor.com Race Results Scraper

A simple, zero-dependency Node.js script to scrape all historical and current race results from any ironman.com race page (or the `labs-v2.competitor.com` results page that ironman.com embeds) and save them as comprehensive CSV files.

This script is designed to fetch all available years for a single event group (e.g., "IRONMAN 70.3 Chattanooga") and create a separate, detailed CSV for each year.

## Features

- **Fetches All Years:** Grabs data for the most recent race _and_ all available past years, or just one year or the most recent year if you prefer.
- **Comprehensive Data:** Exports 30+ columns, including:
  - Finish times and all splits (Swim, T1, Bike, T2, Run).
  - Raw times in seconds (ideal for analysis).
  - Overall, Gender, and Division ranks for the finish and swim, plus split ranks for T1, the bike, T2, and the run, and each athlete's position after the bike (see [Ranks](#ranks)).
  - Status for every athlete: finished, DNF, DNS, DQ, or not classified (see [Status](#status)).
  - Athlete info (City, State, Country).
  - AWA Points.
  - Open Division (ODIV) athletes, which IRONMAN's results API lists separately.
- **No Dependencies:** Uses only built-in Node.js modules (v18+).
- **Interactive:** Prompts you for the URL, a filename, and which year(s) to download.

---

## Prerequisites

- [Node.js](https://nodejs.org/) (Version 18 or higher is recommended, as it includes `fetch` by default).

---

## How to Use

1.  **Check out this repo:** Clone or download the repository to your local machine in an empty folder.
2.  **Open Your Terminal:** Navigate to the folder where you saved the script. There are no dependencies to install.
3.  **Run the Script:**
    ```bash
    node scraper.js
    ```
4.  **Answer the Prompts:**

    **Prompt 1:** `Please paste the race URL:`

    - Paste any page for the race from Ironman's website: the race's home page, its results page, or any other page under it (schedule, course, etc.). The script goes to the race's results page and reads the embedded `labs-v2.competitor.com` "event group" page (the one with the year dropdown).
    - **Example URLs:** `https://www.ironman.com/races/im703-chattanooga/`, `https://www.ironman.com/races/im703-chattanooga/results`
    - You can also paste the `labs-v2.competitor.com` event group URL directly, e.g. `https://labs-v2.competitor.com/results/event/e2352999-586b-e411-93fa-005056951bf1`

    **Prompt 2:** `Enter a base name for the event (e.g., chattanooga):`

    - This name is used to create the output files. If you enter `chattanooga`, the script will generate files like `chattanooga_2025.csv`, `chattanooga_2024.csv`, etc.
    - If an event has more than one race in the same year (e.g., the separate Women's and Men's 70.3 World Championship races), each race gets its own file, like `worlds_2025_women.csv` and `worlds_2025_men.csv`.

    **Prompt 3:** `Enter a year, 'latest', or press Enter for all years:`

    - The script first lists the years available for the event.
    - Press **Enter** (or type `all`) to download every year.
    - Type a year, like `2025`, to download only that year.
    - Type `latest` to download only the most recent year that has results. If this year's race is listed but hasn't been run yet, it falls back to the previous year. For events with more than one race in a year (like the Women's and Men's World Championship), all of that year's races are downloaded.

The script will then fetch the data for the selected year(s) and save the CSV files in the same directory.

---

## Understanding the Data

### Status

| Value | Meaning |
| --- | --- |
| `FIN` | Official finisher. |
| `DNF` | Did not finish. |
| `DNS` | Did not start. |
| `DQ` | Disqualified. |
| `NC` | Not classified: IRONMAN didn't mark them as a finisher, DNF, DNS, or DQ. In recent races these are usually athletes who completed the course outside the time cutoffs. Older races mark the same athletes `DNF`. |

### Ranks

There are two ways to rank a leg of the race, and they can be very different. A weak swimmer who's a strong cyclist might have the 5th-fastest bike split but still be 40th in the race at the end of the bike.

- **Split rank** ranks athletes by the time of that leg alone: who had the fastest bike split, regardless of their swim.
- **Position after a leg** ranks athletes by their total race time at the end of that leg: their place in the race coming off the bike (swim + T1 + bike).

The CSV includes:

| Columns | What they are |
| --- | --- |
| `Overall Rank`, `Gender Rank`, `Division Rank` | IRONMAN's official finish ranks. |
| `Swim Rank (...)` | IRONMAN's swim ranks. For the first leg, the split rank and position after the swim are the same thing. |
| `T1 Split Rank (...)`, `Bike Split Rank (...)`, `T2 Split Rank (...)`, `Run Split Rank (...)` | Calculated by this script from the T1, bike, T2, and run times alone, since IRONMAN doesn't provide them. Athletes with the same time share a rank. |
| `Position After Bike (...)` | IRONMAN's own "bike rank", which is actually the position after the bike. (IRONMAN's "run rank" is the same as the finish rank, so it isn't repeated.) |

A few more notes:

- A rank of `99999` means the athlete isn't ranked (non-finishers, Open Division, etc.). This is the value IRONMAN itself uses.
- If a race didn't have one of the transitions, its split rank columns are left empty. For example, when the swim is canceled and the race starts on the bike, there's no T1, so the T1 split ranks are empty (T2 is still ranked).
- Split ranks only include athletes IRONMAN ranked at the finish. In most races that's the same group IRONMAN's own swim ranks cover. The exception is the oldest races, where IRONMAN's swim ranks and position after bike also include some DNF athletes.
- `Gender` is the gender of the athlete's division, which is what IRONMAN's gender ranks are based on. For divisions without one (e.g., PC, HC, and Open Division), it's the gender from the athlete's profile. Gender split ranks use the same value.
- In the oldest races (e.g., 2006 and 2009), IRONMAN didn't record overall or gender ranks; its division ranks hold each athlete's overall place instead. For those races the script moves that value into `Overall Rank` (and the swim and position-after-bike overall columns), and IRONMAN's gender and division ranks are `99999`. The split ranks are calculated by the script, so they're filled in for every year.

---

## How It Works

This scraper works in three main steps, which is why it's more reliable than a simple HTML scraper:

1.  **Fetch Page Data:** If you entered an ironman.com race page, it goes to that race's `/results` page and follows the embedded `labs-v2.competitor.com` iframe to the event group page. It then parses the `<script id="__NEXT_DATA__">` JSON blob embedded in that page's HTML.
2.  **Find All Events:** It finds the `subevents` key in that JSON to get a list of all available years and their unique `wtc_eventid`s.
3.  **Call the API:** It loops through each selected event and calls the site's internal API (`/api/results?wtc_eventid=...`) to get the complete, clean JSON for that specific year's results. Open Division athletes come from a second call to the same API (`&agegroup=ODIV`).
4.  **Save CSVs:** It parses that JSON and saves it to a CSV file named with your base name and the event year (plus `_women`/`_men` or similar when a year has more than one race).

---

## Troubleshooting

- **"Could not find **NEXT_DATA** script tag...":** The URL you entered is likely incorrect (use a page for the race, e.g. `https://www.ironman.com/races/im703-chattanooga/`), or the website has changed its HTML structure.
- **"Could not find "subevents"...":** You may have used a URL for a single race instead of the main "event group" URL that has the year dropdown.
- **"API request failed...":** The website's API may have changed or is temporarily down.

This script is tailored to the specific HTML and JSON structure of these websites as of late 2026. Future site updates may require changing the keys the script looks for (e.g., `subevents`, `wtc_eventid`, `resultsJson.value`).
