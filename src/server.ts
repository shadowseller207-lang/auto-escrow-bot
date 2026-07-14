import express from 'express';
import cors from 'cors';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import QRCode from 'qrcode';
import prisma from './lib/db';
import path from 'path';

const app = express();
app.use(cors());
app.use(express.json());

// Serve the frontend UI
app.use(express.static(path.join(__dirname, '../public')));

const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret-key-123';

// -----------------------------------------------------
// WEB DASHBOARD APIs (Used by React/HTML Frontend)
// -----------------------------------------------------

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

app.get('/api/dashboard', authenticate, async (req: any, res: any) => {
    try {
        const admin = await prisma.webAdmin.findUnique({ where: { id: req.adminId } });
        const payments = await prisma.transaction.findMany({ orderBy: { createdAt: 'desc' }, take: 100 });
        res.json({ success: true, admin: { username: admin?.username, apiKey: admin?.apiKey, upiId: admin?.upiId }, payments });
    } catch (error) {
        res.status(500).json({ error: "Failed to fetch dashboard data" });
    }
});

app.post('/api/generate-key', authenticate, async (req: any, res: any) => {
    try {
        const newKey = 'pk_live_' + Math.random().toString(36).substr(2, 9) + Date.now().toString(36);
        const admin = await prisma.webAdmin.update({ where: { id: req.adminId }, data: { apiKey: newKey } });
        res.json({ success: true, apiKey: admin.apiKey });
    } catch (error) {
        res.status(500).json({ error: "Failed to generate key" });
    }
});

// -----------------------------------------------------
// TELEGRAM BOT APIs (Used by bot.ts)
// -----------------------------------------------------

app.get('/api/stats', async (req, res) => {
    try {
        const recentTx = await prisma.transaction.findMany({ orderBy: { createdAt: 'desc' }, take: 5 });
        const pendingCount = await prisma.transaction.count({ where: { status: 'PENDING' } });
        const paidCount = await prisma.transaction.count({ where: { status: 'PAID' } });
        
        const aggregations = await prisma.transaction.aggregate({
            _sum: { amount: true },
            where: { status: 'PAID' }
        });
        
        res.json({
            success: true,
            recentTx,
            pendingCount,
            paidCount,
            totalRevenue: aggregations._sum.amount || 0
        });
    } catch (error) {
        res.status(500).json({ success: false, message: "Server error" });
    }
});

app.get('/api/settings', async (req, res) => {
    try {
        const admin = await prisma.webAdmin.findFirst();
        res.json({
            success: true,
            settings: {
                upiId: admin?.upiId,
                merchantName: admin?.merchantName,
                gmailUser: admin?.gmailUser,
                gmailAppPassword: admin?.gmailAppPassword
            }
        });
    } catch (error) {
        res.status(500).json({ success: false });
    }
});

app.post('/api/settings', async (req, res) => {
    try {
        const { upiId, merchantName, gmailUser, gmailAppPassword } = req.body;
        const admin = await prisma.webAdmin.findFirst();
        if (admin) {
            await prisma.webAdmin.update({
                where: { id: admin.id },
                data: { upiId, merchantName, gmailUser, gmailAppPassword }
            });
        }
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false });
    }
});

app.post('/api/pay', async (req, res) => {
    try {
        const { amount, upiId, merchantName } = req.body;
        const orderId = 'ORD' + Math.floor(Math.random() * 1000000);
        await prisma.transaction.create({
            data: { id: orderId, orderId, amount: parseFloat(amount) }
        });
        
        const upiUrl = `upi://pay?pa=${upiId}&pn=${encodeURIComponent(merchantName || 'Merchant')}&am=${amount}&tr=${orderId}&cu=INR`;
        const qrBase64 = await QRCode.toDataURL(upiUrl);

        res.json({ success: true, data: { orderId, qrBase64, upiUrl } });
    } catch (error) {
        res.status(500).json({ success: false });
    }
});

app.post('/api/verify', async (req, res) => {
    try {
        const { orderId } = req.body;
        const payment = await prisma.transaction.findUnique({ where: { orderId: orderId } });
        if (!payment) return res.status(404).json({ success: false, message: "Not found" });
        res.json({ success: true, payment });
    } catch (error) {
        res.status(500).json({ success: false });
    }
});

app.post('/api/v2/verify', async (req, res) => {
    const { orderId } = req.body;
    const payment = await prisma.transaction.findUnique({ where: { orderId: orderId } });
    if (!payment) return res.status(404).json({ error: "Payment not found" });
    res.json({ success: true, payment });
});

// Serve Frontend
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
