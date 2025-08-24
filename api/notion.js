export default async function handler(req, res) {
    const { NOTION_SECRET, DATABASE_ID, DATABASE_ID_CC } = process.env;
  
    // Set CORS headers for all requests
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

    // Handle preflight OPTIONS requests
    if (req.method === 'OPTIONS') {
      return res.status(200).end();
    }

    if (req.method !== 'GET') {
      return res.status(405).json({ message: 'Only GET allowed' });
    }

    // Parse optional query parameter 'type'
    const { type } = req.query;

    // Simple authentication check
    const authHeader = req.headers.authorization;
    
    if (!authHeader || authHeader !== 'Bearer authenticated') {
      return res.status(401).json({ 
        message: 'Authentication required. Please login first.' 
      });
    }
  
    try {
      const notionRes = await fetch(`https://api.notion.com/v1/databases/${type === 'cc' ? DATABASE_ID_CC : DATABASE_ID}/query`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${NOTION_SECRET}`,
          'Notion-Version': '2022-06-28',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ page_size: 100 }) // Optional filtering can go here
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
      res.status(500).json({ message: 'Internal Server Error', error: error.message });
    }
  }
