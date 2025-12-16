# Ironman / Competitor.com Race Results Scraper

A simple, zero-dependency Node.js script to scrape all historical and current race results from a `labs-v2.competitor.com` event page and save them as comprehensive CSV files.

This script is designed to fetch all available years for a single event group (e.g., "IRONMAN 70.3 Chattanooga") and create a separate, detailed CSV for each year.

## Features

- **Fetches All Years:** Grabs data for the most recent race _and_ all available past years.
- **Comprehensive Data:** Exports 30+ columns, including:
  - Finish times and all splits (Swim, T1, Bike, T2, Run).
  - Raw times in seconds (ideal for analysis).
  - Overall, Gender, and Division ranks for the finish, swim, bike, and run.
  - Athlete info (City, State, Country).
  - AWA Points.
- **No Dependencies:** Uses only built-in Node.js modules (v18+).
- **Interactive:** Prompts you for the URL and a filename.

---

## Prerequisites

- [Node.js](https://nodejs.org/) (Version 18 or higher is recommended, as it includes `fetch` by default).

---

## How to Use

1.  **Check out this repo:** Clone or download the repository to your local machine in an empty folder.
2.  **Open Your Terminal:** Navigate to the folder where you saved the script and install the dependency:
    ```bash
    npm install
    ```
3.  **Run the Script:**
    ```bash
    node scraper.js
    ```
4.  **Answer the Prompts:**

    **Prompt 1:** `Please paste the main event group URL:`

    - You must provide the main "event group" URL. This is the page that shows a dropdown for selecting different years (e.g., 2025, 2024). As of the end of 2025, these pages are embedded as iframes within the results pages for each event on Ironman's website.
    - **Example URL:** `https://labs-v2.competitor.com/results/event/17d618ca-6a56-4aae-bda6-7c221acdbb7c`

    **Prompt 2:** `Enter a base name for the event (e.g., chattanooga):`

    - This name is used to create the output files. If you enter `chattanooga`, the script will generate files like `chattanooga_2025.csv`, `chattanooga_2024.csv`, etc.

The script will then fetch the data for each year and save the CSV files in the same directory.

---

## How It Works

This scraper works in three main steps, which is why it's more reliable than a simple HTML scraper:

1.  **Fetch Page Data:** It first fetches the main event group URL and parses the `<script id="__NEXT_DATA__">` JSON blob embedded in the page's HTML.
2.  **Find All Events:** It finds the `subevents` key in that JSON to get a list of all available years and their unique `wtc_eventid`s.
3.  **Call the API:** It loops through each event and calls the site's internal API (`/api/results?wtc_eventid=...`) to get the complete, clean JSON for that specific year's results.
4.  **Save CSVs:** It parses that JSON and saves it to a CSV file named with your base name and the event year.

---

## Troubleshooting

- **"Could not find **NEXT_DATA** script tag...":** The URL you entered is likely incorrect, or the website has changed its HTML structure.
- **"Could not find "subevents"...":** You may have used a URL for a single race instead of the main "event group" URL that has the year dropdown.
- **"API request failed...":** The website's API may have changed or is temporarily down.

This script is tailored to the specific JSON structure of this website as of late 2025. Future site updates may require changing the keys the script looks for (e.g., `subevents`, `wtc_eventid`, `resultsJson.value`).
