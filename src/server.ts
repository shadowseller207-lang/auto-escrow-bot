import express from 'express';
import cors from 'cors';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import prisma from './lib/db';
import path from 'path';

const app = express();
app.use(cors());
app.use(express.json());

// Serve the frontend UI
app.use(express.static(path.join(__dirname, '../public')));

const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret-key-123';

// 1. Admin Login API
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const admin = await prisma.webAdmin.findUnique({ where: { username } });
        if (!admin) return res.status(401).json({ error: "Invalid credentials" });
        
        const isMatch = await bcrypt.compare(password, admin.passwordHash);
        if (!isMatch) return res.status(401).json({ error: "Invalid credentials" });
        
        const token = jwt.sign({ adminId: admin.id }, JWT_SECRET, { expiresIn: '7d' });
        res.json({ success: true, token, admin: { username: admin.username, apiKey: admin.apiKey } });
    } catch (error) {
        res.status(500).json({ error: "Internal server error" });
    }
});

// Middleware to protect dashboard APIs
const authenticate = (req: any, res: any, next: any) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: "No token provided" });
    const token = authHeader.split(' ')[1];
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.adminId = (decoded as any).adminId;
        next();
    } catch (e) {
        res.status(401).json({ error: "Invalid token" });
    }
};

// 2. Fetch Dashboard Data
app.get('/api/dashboard', authenticate, async (req: any, res: any) => {
    try {
        const admin = await prisma.webAdmin.findUnique({ where: { id: req.adminId } });
        const payments = await prisma.transaction.findMany({
            orderBy: { createdAt: 'desc' },
            take: 100
        });
        res.json({
            success: true,
            admin: { username: admin?.username, apiKey: admin?.apiKey, upiId: admin?.upiId },
            payments
        });
    } catch (error) {
        res.status(500).json({ error: "Failed to fetch dashboard data" });
    }
});

// 3. Generate New API Key
app.post('/api/generate-key', authenticate, async (req: any, res: any) => {
    try {
        const newKey = 'pk_live_' + Math.random().toString(36).substr(2, 9) + Date.now().toString(36);
        const admin = await prisma.webAdmin.update({
            where: { id: req.adminId },
            data: { apiKey: newKey }
        });
        res.json({ success: true, apiKey: admin.apiKey });
    } catch (error) {
        res.status(500).json({ error: "Failed to generate key" });
    }
});

// 4. Verify Payment API (Used by your Bot)
app.post('/api/v2/verify', async (req, res) => {
    const { orderId } = req.body;
    const apiKey = req.headers['x-api-key'];
    
    if (!apiKey) return res.status(401).json({ error: "API Key required" });
    const admin = await prisma.webAdmin.findUnique({ where: { apiKey: apiKey as string } });
    if (!admin) return res.status(401).json({ error: "Invalid API Key" });
    
    const payment = await prisma.transaction.findUnique({ where: { orderId: orderId } });
    if (!payment) return res.status(404).json({ error: "Payment not found" });
    
    res.json({ success: true, payment });
});

// 5. Serve Frontend
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
