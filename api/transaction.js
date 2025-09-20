import { getDatabaseId } from '../utils/utils.js';

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
// check auth and check if user is there
  const authHeader = req.headers.authorization;
  if (!authHeader || authHeader !== 'Bearer authenticated') {
    return res.status(401).json({ 
      message: 'Authentication required. Please login first.' 
    });
  }
  const { USER_TABLE_ID, NOTION_SECRET } = process.env;
  const { 
    amount, 
    expense, 
    category, 
    paymentMethod, 
    uuid, 
    userName,
    date = new Date().toISOString().split('T')[0], // Default to today
    isMe,
  } = req.body;

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
  const user = usersRes.results.find(user => user.properties.userName.title[0].plain_text === userName && user.properties.uuid.rich_text[0]?.plain_text === uuid);
  if (!user) {
    return res.status(401).json({ 
      message: 'User not found' 
    });
  }
  // Validate required fields
  if (!amount || !expense || !category || !paymentMethod || !uuid || !userName) {
    return res.status(400).json({ 
      message: 'Missing required fields: amount, expense, category, paymentMethod, uuid, userName' 
    });
  }

  try {
    // Create transaction in Notion
    const notionRes = await fetch(`https://api.notion.com/v1/pages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${NOTION_SECRET}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        parent: { database_id: getDatabaseId('', isMe) },
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
          },
          "uuid":{
            rich_text: [{ text: { content: uuid } }]
          },
          "userName": {
            rich_text: [{ text: { content: userName } }]
          }
        }
      })
    });

    const data = await notionRes.json();

    if (!notionRes.ok) {
      console.error('Notion Error:', data);
      return res.status(notionRes.status).json({
        message: 'Failed to create transaction',
        error: data
      });
    }

    return res.status(201).json({
      success: true,
      message: 'Transaction logged successfully',
      transaction: {
        amount: parseFloat(amount),
        expense,
        category,
        paymentMethod,
        date,
        uuid,
        userName
      }
    });

  } catch (error) {
    console.error('Transaction Logging Error:', error);
    return res.status(500).json({ 
      message: 'Internal Server Error', 
      error: error.message 
    });
  }
}
