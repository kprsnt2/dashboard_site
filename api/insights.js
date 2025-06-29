// api/insights.js
export const dynamic = 'force-dynamic'; // Keep this at the very top

import { BigQuery } from '@google-cloud/bigquery';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { get as readEdgeConfig } from '@vercel/edge-config';
// Assuming Node.js 18+ and native fetch is available, no import for fetch needed

// Load BigQuery credentials from environment variable
const credentials = JSON.parse(process.env.BIGQUERY_CREDENTIALS);

const bigquery = new BigQuery({
  projectId: credentials.project_id,
  credentials,
});

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const INSIGHT_KEY = 'latest_cricketer_insight';
const VERCEL_EDGE_CONFIG_ID = process.env.EDGE_CONFIG_ID;
const VERCEL_API_TOKEN = process.env.VERCEL_API_TOKEN;


async function generateInsight() {
  let newInsight = "Insight not generated yet.";
  try {
    const query = `SELECT source_name, title, brand, title_sentiment_category FROM \`isentropic-keep-450218-e5.Brand.cricketers_tb_sentiment\` WHERE DATE(published_at) = (SELECT DATE(MAX(published_at)) FROM \`isentropic-keep-450218-e5.Brand.cricketers_tb_sentiment\`) ORDER BY published_at DESC`;
    const [rows] = await bigquery.query({ query });

    if (!rows || rows.length === 0) {
      newInsight = "No data available in BigQuery to generate insight.";
    } else {
      const latestData = rows[0];
      const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
      const prompt = `You are an expert cricket news analyst. Here is a JSON array of recent articles about cricketers. Each object contains 'source_name', 'title', 'brand' (cricketer name), and 'title_sentiment_category' (e.g., 'Positive', 'Negative', 'Neutral').

      Your task is to provide a concise, insightful, and actionable summary for a daily report. Focus on:
      1.  **Top Brands (Cricketers) by Coverage:** Identify which cricketers received the most articles.
      2.  **Sentiment Analysis (Highlighting Negative):** For each mentioned cricketer, summarize their overall sentiment. **Explicitly highlight if a cricketer has a notable amount of negative sentiment and provide a brief context if possible (e.g., "X had significant negative sentiment due to Y").**
      3.  **Top Publishing Sources:** Identify which sources published the most articles related to cricketers.

      Keep the language professional and clear. Do not just list data; provide an interpretive summary.

      Here is the data:
      ${JSON.stringify(rows, null, 2)}
      `;

      const result = await model.generateContent(prompt);
      newInsight = result.response.text();
    }

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
            operation: 'upsert',
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

async function readInsightFromEdgeConfig() {
  try {
    const insight = await readEdgeConfig(INSIGHT_KEY);
    if (insight === undefined || insight === null) {
      return "Insight not yet generated for today. Please wait for the daily update.";
    }
    return insight;
  } catch (err) {
    console.error("Error reading insight from Vercel Edge Config:", err);
    return "Unable to load insights at the moment.";
  }
}

export default async function handler(req, res) {
  // Check if the request is from the Vercel cron job
  // The 'user-agent' header is 'vercel-cron/1.0' for Vercel Cron Jobs
  const isVercelCron = req.headers['user-agent'] && req.headers['user-agent'].startsWith('vercel-cron/');

  if (isVercelCron) {
    console.log("Request from Vercel Cron Job detected. Generating insight...");
    await generateInsight();
    // Vercel Cron Jobs expect a 200 OK response to mark success.
    // The response body doesn't matter much for the cron job itself.
    return res.status(200).json({ message: "Insight generation triggered by cron job." });
  }

  // Handle regular GET requests from your frontend
  if (req.method === 'GET') {
    console.log("GET request received, reading insight from Edge Config...");
    const currentInsight = await readInsightFromEdgeConfig();
    return res.status(200).json({ insight: currentInsight });
  }

  // Handle other methods (like POST from manual triggers, if you still use them)
  if (req.method === 'POST') {
    console.log("POST request received (likely manual trigger), generating insight...");
    await generateInsight();
    return res.status(200).json({ message: "Insight refreshed." });
  }

  // For any other unexpected methods
  return res.status(405).json({ message: 'Method Not Allowed' });
}
