export default async function handler(req, res) {
    // Set CORS headers
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  
    // Handle preflight requests
    if (req.method === 'OPTIONS') {
      return res.status(200).end();
    }
  
    // Only allow POST requests
    if (req.method !== 'POST') {
      return res.status(405).json({ message: 'Method not allowed' });
    }
  
    // Check auth
    const authHeader = req.headers.authorization;
    if (!authHeader || authHeader !== 'Bearer authenticated') {
      return res.status(401).json({
        message: 'Authentication required. Please login first.'
      });
    }
  
    const { USER_TABLE_ID, NOTION_SECRET } = process.env;
    const { pageId, uuid, userName } = req.body;
  
    // Validate required fields
    if (!pageId || !uuid || !userName) {
      return res.status(400).json({
        message: 'Missing required fields: pageId, uuid, userName'
      });
    }
  
    // Verify user exists
    const users = await fetch(`https://api.notion.com/v1/databases/${USER_TABLE_ID}/query`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${NOTION_SECRET}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ page_size: 100 })
    });
    const usersRes = await users.json();
    const user = usersRes.results.find(
      u =>
        u.properties.userName.title[0].plain_text === userName &&
        u.properties.uuid.rich_text[0]?.plain_text === uuid
    );
    if (!user) {
      return res.status(401).json({ message: 'User not found' });
    }
  
    try {
      // Verify the page belongs to this user before deleting
      const pageRes = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${NOTION_SECRET}`,
          'Notion-Version': '2022-06-28'
        }
      });
  
      if (!pageRes.ok) {
        return res.status(404).json({ message: 'Transaction not found' });
      }
  
      const page = await pageRes.json();
  
      // Security check: make sure the page's uuid matches the requesting user
      const pageUuid = page.properties?.uuid?.rich_text?.[0]?.plain_text;
      const pageUserName = page.properties?.userName?.rich_text?.[0]?.plain_text;
  
      if (pageUuid !== uuid || pageUserName !== userName) {
        return res.status(403).json({
          message: 'Forbidden: you do not own this transaction'
        });
      }
  
      // Archive (soft-delete) the Notion page
      const deleteRes = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${NOTION_SECRET}`,
          'Notion-Version': '2022-06-28',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ archived: true })
      });
  
      const deleteData = await deleteRes.json();
  
      if (!deleteRes.ok) {
        console.error('Notion delete error:', deleteData);
        return res.status(deleteRes.status).json({
          message: 'Failed to delete transaction',
          error: deleteData
        });
      }
  
      return res.status(200).json({
        success: true,
        message: 'Transaction deleted successfully',
        pageId
      });
  
    } catch (error) {
      console.error('Delete Transaction Error:', error);
      return res.status(500).json({
        message: 'Internal Server Error',
        error: error.message
      });
    }
  }