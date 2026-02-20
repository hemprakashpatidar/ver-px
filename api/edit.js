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
    const {
      pageId,
      uuid,
      userName,
      expense,
      amount,
      category,
      paymentMethod,
      date,
    } = req.body;
  
    // Validate required fields
    if (!pageId || !uuid || !userName || !expense || !amount || !category || !paymentMethod || !date) {
      return res.status(400).json({
        message: 'Missing required fields: pageId, uuid, userName, expense, amount, category, paymentMethod, date'
      });
    }
  
    // Verify user exists
    const usersRes = await fetch(`https://api.notion.com/v1/databases/${USER_TABLE_ID}/query`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${NOTION_SECRET}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ page_size: 100 })
    });
    const usersData = await usersRes.json();
    const user = usersData.results.find(
      u =>
        u.properties.userName.title[0].plain_text === userName &&
        u.properties.uuid.rich_text[0]?.plain_text === uuid
    );
    if (!user) {
      return res.status(401).json({ message: 'User not found' });
    }
  
    try {
      // Fetch the page to verify ownership
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
  
      // Security check: make sure the page belongs to this user
      const pageUuid = page.properties?.uuid?.rich_text?.[0]?.plain_text;
      const pageUserName = page.properties?.userName?.rich_text?.[0]?.plain_text;
  
      if (pageUuid !== uuid || pageUserName !== userName) {
        return res.status(403).json({
          message: 'Forbidden: you do not own this transaction'
        });
      }
  
      // Update the Notion page properties
      const updateRes = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${NOTION_SECRET}`,
          'Notion-Version': '2022-06-28',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          properties: {
            "Expense": {
              title: [{ text: { content: expense } }]
            },
            "Amount": {
              number: parseFloat(amount)
            },
            "Category": {
              select: { name: category }
            },
            "Date": {
              date: { start: date }
            },
            "Payment Method": {
              select: { name: paymentMethod }
            }
          }
        })
      });
  
      const updateData = await updateRes.json();
  
      if (!updateRes.ok) {
        console.error('Notion update error:', updateData);
        return res.status(updateRes.status).json({
          message: 'Failed to update transaction',
          error: updateData
        });
      }
  
      return res.status(200).json({
        success: true,
        message: 'Transaction updated successfully',
        transaction: {
          pageId,
          expense,
          amount: parseFloat(amount),
          category,
          paymentMethod,
          date,
        }
      });
  
    } catch (error) {
      console.error('Edit Transaction Error:', error);
      return res.status(500).json({
        message: 'Internal Server Error',
        error: error.message
      });
    }
  }