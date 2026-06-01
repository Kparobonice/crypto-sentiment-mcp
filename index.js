import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { verifyContextRequest } from "@ctxprotocol/sdk";
import { z } from "zod";

const NEWS_API_KEY = "pub_1df377b5cd0444d993f1dcf5311390cf";
const NEWS_BASE_URL = "https://newsdata.io/api/1/news";

const app = express();
app.use(express.json());

function createMcpServer() {
  const server = new McpServer({
    name: "crypto-news-sentiment",
    version: "1.0.0",
  });

  // Tool: Get Crypto News & Sentiment
  server.tool(
    "get_crypto_news_sentiment",
    "Fetches the latest crypto news with sentiment analysis for any token or topic. Returns headlines, sources, sentiment scores, and publication times.",
    {
      coin: z
        .string()
        .optional()
        .describe("Coin/token to filter news for, e.g. 'bitcoin', 'ethereum', 'solana'"),
      sentiment: z
        .enum(["positive", "negative", "neutral"])
        .optional()
        .describe("Filter by sentiment: positive, negative, or neutral"),
      limit: z
        .number()
        .min(1)
        .max(10)
        .default(5)
        .describe("Number of news articles to return (max 10)"),
    },
    {
      outputSchema: {
        type: "object",
        properties: {
          query: { type: "string" },
          total_results: { type: "number" },
          sentiment_summary: {
            type: "object",
            properties: {
              positive: { type: "number" },
              negative: { type: "number" },
              neutral: { type: "number" },
              overall: { type: "string" },
            },
            required: ["positive", "negative", "neutral", "overall"],
          },
          articles: {
            type: "array",
            items: {
              type: "object",
              properties: {
                title: { type: "string" },
                description: { type: "string" },
                source: { type: "string" },
                sentiment: { type: "string" },
                published_at: { type: "string" },
                url: { type: "string" },
              },
              required: ["title", "source", "sentiment", "published_at"],
            },
          },
        },
        required: ["query", "total_results", "sentiment_summary", "articles"],
      },
    },
    async ({ coin, sentiment, limit }) => {
      const params = new URLSearchParams({
        apikey: NEWS_API_KEY,
        language: "en",
        category: "business,technology",
        q: coin || "cryptocurrency",
        size: String(limit),
      });

      if (sentiment) params.append("sentiment", sentiment);

      const response = await fetch(`${NEWS_BASE_URL}?${params}`);
      const data = await response.json();

      if (data.status !== "success") {
        throw new Error(`NewsData API error: ${data.message || "Unknown error"}`);
      }

      const articles = (data.results || []).map((article) => ({
        title: article.title || "No title",
        description: article.description || "No description available",
        source: article.source_name || "Unknown",
        sentiment: article.sentiment || "neutral",
        published_at: article.pubDate || "Unknown",
        url: article.link || "",
      }));

      // Build sentiment summary
      const counts = { positive: 0, negative: 0, neutral: 0 };
      articles.forEach((a) => {
        if (counts[a.sentiment] !== undefined) counts[a.sentiment]++;
        else counts.neutral++;
      });

      const total = articles.length || 1;
      const overall =
        counts.positive / total > 0.5
          ? "Bullish"
          : counts.negative / total > 0.5
          ? "Bearish"
          : "Neutral";

      const result = {
        query: coin || "cryptocurrency",
        total_results: data.totalResults || articles.length,
        sentiment_summary: { ...counts, overall },
        articles,
      };

      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
        structuredContent: result,
      };
    }
  );

  return server;
}

// Health check
app.get("/health", (_, res) => res.json({ status: "ok", tool: "crypto-news-sentiment" }));

// MCP endpoint
app.all("/mcp", async (req, res) => {
  const isProtected =
    req.body?.method && req.body.method !== "tools/list" && req.body.method !== "initialize";

  if (isProtected) {
    try {
      await verifyContextRequest({
        authorizationHeader: req.headers.authorization,
      });
    } catch {
      return res.status(401).json({ error: "Unauthorized - valid Context Protocol JWT required" });
    }
  }

  const server = createMcpServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Crypto News & Sentiment MCP server running on port ${PORT}`);
});
