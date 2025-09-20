import { getDatabaseId, buildNotionFilter } from '../utils/utils.js';
export default async function handler(req, res) {
    const { NOTION_SECRET} = process.env;
  
    // Set CORS headers for all requests
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS,POST");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

    // Handle preflight OPTIONS requests
    if (req.method === 'OPTIONS') {
      return res.status(200).end();
    }

    if (req.method !== 'POST') {
      return res.status(405).json({ message: 'Only POST allowed' });
    }

    // Get parameters from body (POST)
    const {isMe, type, uuid, userName } = req.body;

    // Simple authentication check
    const authHeader = req.headers.authorization;
    
    if (!authHeader || authHeader !== 'Bearer authenticated') {
      return res.status(401).json({ 
        message: 'Authentication required. Please login first.' 
      });
    }
    const databaseId = getDatabaseId(type, isMe);
    
    try {
      const filter = buildNotionFilter(uuid, userName);
      
      // Build request body - only include filter if it exists
      const requestBody = { page_size: 100 };
      if (filter) {
        requestBody.filter = filter;
      }
      const notionRes = await fetch(`https://api.notion.com/v1/databases/${databaseId}/query`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${NOTION_SECRET}`,
          'Notion-Version': '2022-06-28',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
      });
  
      const data = await notionRes.json();
  
      if (!notionRes.ok) {
        return res.status(notionRes.status).json(data);
      }
  
      // Extract only properties from each result, keeping the results structure
      const resultsWithPropertiesOnly = data.results.map(result => ({
        properties: result.properties
      }));
      return res.status(200).json({ results: resultsWithPropertiesOnly });
    } catch (error) {
      console.error('Notion Proxy Error:', error);
      
      // Handle validation errors
      if (error.message.includes('Both uuid and userName are required')) {
        return res.status(400).json({ 
          message: 'Both uuid and userName parameters are required for filtering' 
        });
      }
      
      res.status(500).json({ message: 'Internal Server Error', error: error.message });
    }
  }
