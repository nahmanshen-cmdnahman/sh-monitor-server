const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const { OAuth2Client } = require('google-auth-library');
require('dotenv').config();

const app = express();

const CLIENT_ID = '714314603024-4768q9ik6bnhnckuktd1q17vshn7puse.apps.googleusercontent.com';
const googleClient = new OAuth2Client(CLIENT_ID);

// 1. הגבלת CORS - גישה אך ורק מהאתר שלך
const allowedOrigins = ['https://sh-monitor.vercel.app'];
app.use(cors({
  origin: function (origin, callback) {
    // מאפשר בקשות ללא origin (כמו Postman/Server-to-Server) רק בסביבת פיתוח
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Blocked by CORS policy'));
    }
  },
  credentials: true
}));

app.use(express.json());

// 2. התחברות ל-MongoDB
let isConnected = false;
const connectDB = async () => {
  if (isConnected) return;
  try {
    const db = await mongoose.connect(process.env.MONGODB_URI);
    isConnected = db.connections[0].readyState;
    console.log('MongoDB Connected');
  } catch (error) {
    console.error('MongoDB connection error:', error);
  }
};

// 3. הגדרת המודל ב-MongoDB (Device Pair Schema)
const DeviceSchema = new mongoose.Schema({
  mail: { type: String, required: true, index: true },
  device: { type: String, required: true, unique: true },
  createdAt: { type: Date, default: Date.now }
});

const Device = mongoose.models.Device || mongoose.model('Device', DeviceSchema);

// middleware לוודא חיבור ל-DB בכל פנייה
app.use(async (req, res, next) => {
  await connectDB();
  next();
});

// 4. Endpoint לרישום/קישור מכשיר מקבל לשרת
app.post('/api/pair-device', async (req, res) => {
  try {
    const { token, deviceId } = req.body;

    if (!token || !deviceId) {
      return res.status(400).json({ error: 'Missing token or deviceId' });
    }

    // אימות ה-Token של גוגל מול השרתים של Google
    const ticket = await googleClient.verifyIdToken({
      idToken: token,
      audience: CLIENT_ID,
    });
    const payload = ticket.getPayload();
    const userEmail = payload.email;

    if (!userEmail) {
      return res.status(401).json({ error: 'Invalid Google Token' });
    }

    // שמירה או עדכון ה-device עבור כתובת המייל
    const updatedDevice = await Device.findOneAndUpdate(
      { device: deviceId },
      { mail: userEmail, createdAt: new Date() },
      { upsert: true, new: true }
    );

    return res.status(200).json({
      success: true,
      message: 'Device paired successfully',
      data: {
        mail: updatedDevice.mail,
        device: updatedDevice.device
      }
    });

  } catch (error) {
    console.error('Pairing error:', error);
    return res.status(401).json({ error: 'Authentication or server error', details: error.message });
  }
});

// בדיקת תקינות השרת (Health Check)
app.get('/', (req, res) => {
  res.send('SH Monitor Server is running');
});

// יצוא האפליקציה עבור Vercel Serverless Functions
module.exports = app;