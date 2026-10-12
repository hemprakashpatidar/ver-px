import { getDatabaseId } from '../utils/utils.js';

export default async function handler(req, res) {
  const { uuid, userName, isMe } = req.user;
  const { 
    amount, 
    expense, 
    category, 
    paymentMethod, 
    date = new Date().toISOString().split('T')[0], // Default to today
  } = req.body;

  // Validate required fields
  if (!amount || !expense || !category || !paymentMethod) {
    return res.status(400).json({ 
      message: 'Missing required fields: amount, expense, category, paymentMethod' 
    });
  }

  try {
    // Create transaction in Notion
    const notionRes = await fetch(`https://api.notion.com/v1/pages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.NOTION_SECRET}`,
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
        message: 'Failed to create transaction'
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
        date
      }
    });

  } catch (error) {
    console.error('Transaction Logging Error:', error);
    return res.status(500).json({ 
      message: 'Internal Server Error'
    });
  }
}
