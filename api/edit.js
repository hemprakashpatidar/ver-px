export default async function handler(req, res) {
    const { NOTION_SECRET } = process.env;
    const { uuid, userName } = req.user;
    const {
      pageId,
      expense,
      amount,
      category,
      paymentMethod,
      date,
    } = req.body;
  
    // Validate required fields
    if (!pageId || !expense || !amount || !category || !paymentMethod || !date) {
      return res.status(400).json({
        message: 'Missing required fields: pageId, expense, amount, category, paymentMethod, date'
      });
    }
  
    if (!/^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i.test(pageId)) {
      return res.status(400).json({ message: 'Invalid pageId' });
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
          message: 'Failed to update transaction'
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
        message: 'Internal Server Error'
      });
    }
  }