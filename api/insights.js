// api/insights.js

import { BigQuery } from '@google-cloud/bigquery';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { get as readEdgeConfig } from '@vercel/edge-config'; // For reading

// Load BigQuery credentials from environment variable
const credentials = JSON.parse(process.env.BIGQUERY_CREDENTIALS);

const bigquery = new BigQuery({
  projectId: credentials.project_id,
  credentials,
});

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Define the key for your insight in Edge Config
const INSIGHT_KEY = 'latest_cricketer_insight'; // This will be the key in your Edge Config store

// Vercel API details for writing to Edge Config
const VERCEL_EDGE_CONFIG_ID = process.env.EDGE_CONFIG_ID; // Vercel sets this for you
const VERCEL_API_TOKEN = process.env.VERCEL_API_TOKEN; // Your manually added API Token

async function generateInsight() {
  let newInsight = "Insight not generated yet.";
  try {
    const query = `SELECT * FROM \`isentropic-keep-450218-e5.Brand.cricketers_tb_sentiment\` ORDER BY published_at DESC LIMIT 1`; // Your corrected query
    const [rows] = await bigquery.query({ query });

    if (!rows || rows.length === 0) {
      newInsight = "No data available in BigQuery to generate insight.";
    } else {
      const latestData = rows[0];
      const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
      const prompt = `Based on this data: ${JSON.stringify(latestData)}, provide a concise and insightful summary for a daily report on cricketers where brand column has the cricketer names.`;
      const result = await model.generateContent(prompt);
      newInsight = result.response.text();
    }

    // NEW: Write the generated insight to Vercel Edge Config via REST API
    if (!VERCEL_EDGE_CONFIG_ID || !VERCEL_API_TOKEN) {
      throw new Error("Vercel Edge Config ID or API Token environment variables are not set.");
    }

    const updateUrl = `https://api.vercel.com/v1/edge-config/${VERCEL_EDGE_CONFIG_ID}/items`;
    const response = await fetch(updateUrl, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${VERCEL_API_TOKEN}`,
      },
      body: JSON.stringify({
        items: [
          {
            operation: 'upsert', // Create or update the item
            key: INSIGHT_KEY,
            value: newInsight,
          },
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to update Edge Config: ${response.status} - ${errorText}`);
    }

    console.log(`Insight successfully saved to Vercel Edge Config with key: ${INSIGHT_KEY}`);

  } catch (err) {
    newInsight = `Error generating insight: ${err.message}`;
    console.error("Insight generation failed:", err);
    // Optionally, try to save the error message to Edge Config as well,
    // though the failure might be due to the Edge Config write itself.
    // This is more resilient if the insight generation failed but Edge Config is accessible.
    try {
      if (VERCEL_EDGE_CONFIG_ID && VERCEL_API_TOKEN) {
        const updateUrl = `https://api.vercel.com/v1/edge-config/${VERCEL_EDGE_CONFIG_ID}/items`;
        await fetch(updateUrl, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${VERCEL_API_TOKEN}`,
          },
          body: JSON.stringify({
            items: [
              {
                operation: 'upsert',
                key: INSIGHT_KEY,
                value: newInsight,
              },
            ],
          }),
        });
      }
    } catch (innerErr) {
      console.error("Failed to save error message to Edge Config:", innerErr);
    }
  }
}

// Function to read insight from Edge Config
async function readInsightFromEdgeConfig() {
  try {
    const insight = await readEdgeConfig(INSIGHT_KEY); // Use the imported 'get' function
    if (insight === undefined || insight === null) { // Edge Config returns undefined if key doesn't exist
      return "Insight not yet generated for today. Please wait for the daily update.";
    }
    return insight;
  } catch (err) {
    console.error("Error reading insight from Vercel Edge Config:", err);
    return "Unable to load insights at the moment.";
  }
}

export default async function handler(req, res) {
  if (req.method === 'POST') {
    console.log("POST request received, generating insight...");
    await generateInsight();
    return res.status(200).json({ message: "Insight refreshed." });
  } else {
    console.log("GET request received, reading insight from Edge Config...");
    const currentInsight = await readInsightFromEdgeConfig();
    return res.status(200).json({ insight: currentInsight });
  }
}
