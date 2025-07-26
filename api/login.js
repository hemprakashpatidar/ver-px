export default async function handler(req, res) {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const { username, password } = req.body;

  // Get credentials from environment variables
  const validUsername = process.env.AUTH_USERNAME;
  const validPassword = process.env.AUTH_PASSWORD;

  // Check if environment variables are set
  if (!validUsername || !validPassword) {
    return res.status(500).json({ 
      message: 'Authentication not configured. Please contact administrator.' 
    });
  }

  // Check if credentials are valid
  if (username !== validUsername || password !== validPassword) {
    return res.status(401).json({ 
      message: 'Invalid credentials. Please check your username and password.' 
    });
  }

  // Return success response
  return res.status(200).json({
    success: true,
    message: 'Login successful'
  });
} 
