import { getDatabaseId, buildNotionFilter, getMonthFilterConfig } from '../utils/utils.js';
export default async function handler(req, res) {
    const { NOTION_SECRET} = process.env;

    const { uuid, userName, isMe } = req.user;
    const { type, month, year } = req.body;

    const monthNum = Number(month);
    const yearNum = Number(year);
    if (!Number.isInteger(monthNum) || monthNum < 1 || monthNum > 12 || !Number.isInteger(yearNum)) {
      return res.status(400).json({ message: 'Valid month (1-12) and year are required' });
    }

    const databaseId = getDatabaseId(type, isMe);

    try {
      const {startDate, endDate} = getMonthFilterConfig(monthNum, yearNum)
      const filter = buildNotionFilter(uuid, userName, startDate, endDate);

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
        console.error('Notion query error:', data);
        return res.status(502).json({ message: 'Failed to fetch transactions' });
      }

      // Extract only properties from each result, keeping the results structure
      const resultsWithPropertiesOnly = data.results.map(result => ({
        properties: result.properties,
        id: result.id
      }));
      return res.status(200).json({ results: resultsWithPropertiesOnly });
    } catch (error) {
      console.error('Notion Proxy Error:', error);
      res.status(500).json({ message: 'Internal Server Error' });
    }
  }
