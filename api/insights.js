// File: api/insights.js

import { BigQuery } from '@google-cloud/bigquery';
import { GoogleGenerativeAI } from '@google/generative-ai';

// Load BigQuery credentials from environment variable
const credentials = JSON.parse(process.env.BIGQUERY_CREDENTIALS);

const bigquery = new BigQuery({
  projectId: credentials.project_id,
  credentials,
});

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Cache insight (in-memory per function instance)
let cachedInsight = "Insight not generated yet.";

async function generateInsight() {
  try {
    // Query the latest data from BigQuery
    const query = `SELECT * FROM \`isentropic-keep-450218-e5.Brand.cricketers_tb_sentiment\` ORDER BY published_at DESC LIMIT 1`;
    const [rows] = await bigquery.query({ query });

    if (!rows || rows.length === 0) {
      cachedInsight = "No data available in BigQuery.";
      return;
    }

    const latestData = rows[0];

    // Ask Gemini for insight
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
    const prompt = `Based on this data: ${JSON.stringify(latestData)}, provide a concise and insightful summary for a daily report on cricketers where brand column has the cricketer names.`;

    const result = await model.generateContent(prompt);
    cachedInsight = result.response.text();
  } catch (err) {
    cachedInsight = `Error generating insight: ${err.message}`;
    console.error("Insight generation failed:", err);
  }
}

export default async function handler(req, res) {
  if (req.method === 'POST') {
    await generateInsight();
    return res.status(200).json({ message: "Insight refreshed." });
  } else {
    return res.status(200).json({ insight: cachedInsight });
  }
}
