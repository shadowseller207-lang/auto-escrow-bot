import express from 'express';
import cors from 'cors';
import prisma from './lib/db';

const app = express();
app.use(cors());
app.use(express.json());

app.post('/api/v2/verify', async (req, res) => {
    const { orderId } = req.body;
    const apiKey = req.headers['x-api-key'];
    
    if (!apiKey) return res.status(401).json({ error: "API Key required" });
    
    const admin = await prisma.webAdmin.findUnique({ where: { apiKey: apiKey as string } });
    if (!admin) return res.status(401).json({ error: "Invalid API Key" });

    const payment = await prisma.payment.findUnique({ where: { id: orderId } });
    if (!payment) return res.status(404).json({ error: "Payment not found" });

    res.json({ success: true, payment });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
