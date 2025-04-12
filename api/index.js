import { kv } from "@vercel/kv"; // 1. Import Vercel KV client
import cors from "cors";
import express from "express";
import rateLimit from "express-rate-limit";

console.log("[API] index.js loaded successfully."); // <-- Updated filename

const app = express();
// const PORT = process.env.PORT || 3000; // <-- Removed unused constant

app.set('trust proxy', 1); // Trust first proxy (Vercel)

// --- CORS Configuration (Improved) ---
const allowedOrigins = [
    process.env.NODE_ENV === 'development' ? 'http://localhost:5173' : null, // Allow localhost in dev
    'https://escape-road-online.com', // Your production frontend URL
    process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null // Allow Vercel preview deployments
].filter(Boolean); // Filter out null values

const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) === -1) {
      const msg = 'The CORS policy for this site does not allow access from the specified Origin.';
      console.warn(`CORS blocked origin: ${origin}`); // Log blocked origins
      return callback(new Error(msg), false);
    }
    return callback(null, true);
  },
  methods: "GET,HEAD,PUT,PATCH,POST,DELETE",
  credentials: true,
};
app.use(cors(corsOptions));
app.use(express.json()); // Middleware to parse JSON bodies

// --- Rate Limiters (Keep existing logic) ---
const keyGenerator = (req /*, res */) => {
    const pageId = req.method === 'POST' ? req.body?.pageId : req.query?.pageId;
    const ip = req.ip || 'unknown_ip';
    return `${ip}-${pageId || 'unknown_page'}`;
};

const createLimiter = (message, max = 1) => rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: max,
    keyGenerator: keyGenerator,
    handler: (req, res, next, options) => {
        console.warn(`Rate limit exceeded for IP: ${req.ip}, Page: ${req.body?.pageId || req.query?.pageId}, Path: ${req.path}`);
        res.status(options.statusCode).json({ message: options.message });
    },
    message: message,
    standardHeaders: true,
    legacyHeaders: false,
});

const commentLimiter = createLimiter('You can only post one comment per game every minute. Please try again later.');
const ratingLimiter = createLimiter('You can only submit one rating per game every minute. Please try again later.');
const getLimiter = createLimiter('Too many requests, please try again later.', 30);

// --- Helper Functions (Improved calculateRatingStats) ---
const initializeRatingCounts = () => ({ '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 }); // Kept for reference, but not strictly needed if calculate handles null

const calculateRatingStats = (ratingCounts) => {
    let totalScore = 0;
    let count = 0;
    // Ensure ratingCounts is a valid object before iterating
    const safeRatingCounts = (typeof ratingCounts === 'object' && ratingCounts !== null) ? ratingCounts : {};

    // Iterate explicitly from 1 to 5 to avoid issues with unexpected hash keys
    for (let i = 1; i <= 5; i++) {
        const key = String(i);
        // Ensure the value is parsed correctly as an integer
        const numRatings = parseInt(safeRatingCounts[key] || 0, 10);
        if (!isNaN(numRatings) && numRatings > 0) { // Only consider valid, positive counts
            totalScore += numRatings * i;
            count += numRatings;
        }
    }
    // Return 0 average if count is 0 (Fix: was 5.0)
    const average = count > 0 ? totalScore / count : 0;
    return { average: parseFloat(average.toFixed(1)), count };
};

// Validation helper remains the same
const validateInput = (input, type, maxLength = Infinity) => {
    if (typeof input !== 'string' || input.trim() === '') {
        return `${type} cannot be empty.`;
    }
    if (input.trim().length > maxLength) {
         return `${type} is too long (max ${maxLength} characters).`;
    }
    return null; // No error
};


// --- Public API Routes ---

// GET /api/comments?pageId=xxx
app.get('/api/comments', getLimiter, async (req, res) => {
    // console.log("--- [SIMPLIFIED TEST] GET /api/comments invoked --- "); // Removed test log
    const pageId = req.query.pageId;
    // console.log(`--- [SIMPLIFIED TEST] pageId received: ${pageId} ---`); // Removed test log

    if (!pageId || typeof pageId !== 'string') {
        // console.log("--- [SIMPLIFIED TEST] Invalid pageId, returning 400 ---"); // Removed test log
        return res.status(400).json({ message: 'Valid pageId query parameter is required.' });
    }

    // --- Original KV Logic (Restored) ---
    try {
        const commentsJson = await kv.lrange(`comments:${pageId}`, 0, -1);
        console.log(`[API] Fetched ${commentsJson.length} raw comment strings for ${pageId}`); // Added log for raw count

        const comments = commentsJson.map((commentStr, index) => {
            try {
                const comment = JSON.parse(commentStr);
                // Basic validation: check if it has id AND text
                if (!comment || typeof comment.id === 'undefined' || typeof comment.text === 'undefined') {
                    console.warn(`[API] Parsed comment at index ${index} for pageId ${pageId} lacks essential fields (id, text). Raw:`, commentStr);
                    return null;
                }
                return comment;
            } catch (e) {
                console.error(`[API] Failed to parse comment JSON at index ${index} for pageId ${pageId}:`, e.message, 'Raw data:', commentStr);
                return null;
            }
        }).filter(comment => comment !== null);
        
        console.log(`[API] Successfully parsed and validated ${comments.length} comments for ${pageId}`); // Added log for final count
        res.status(200).json(comments);

    } catch (error) {
        console.error(`[API] Error in GET /api/comments handler for pageId ${pageId}:`, error);
        res.status(500).json({ message: 'Internal server error fetching comments.' });
    }
    // --- End of Original KV Logic ---

    // --- Dummy Data (Removed) ---
    // console.log("--- [SIMPLIFIED TEST] Returning hardcoded dummy comment data --- ");
    // const dummyComments = [...];
    // res.status(200).json(dummyComments);
    // console.log("--- [SIMPLIFIED TEST] Dummy response sent --- ");
});

// POST /api/comments (Improved ID generation)
app.post('/api/comments', commentLimiter, async (req, res) => {
    const { pageId, name, text } = req.body;

    const pageIdError = validateInput(pageId, 'Page ID');
    if (pageIdError) return res.status(400).json({ message: pageIdError });
    const nameError = validateInput(name, 'Name', 100);
    if (nameError) return res.status(400).json({ message: nameError });
    const textError = validateInput(text, 'Comment', 500);
    if (textError) return res.status(400).json({ message: textError });

    console.log(`[API] POST /api/comments received for pageId: ${pageId}`);

    const newComment = {
        // Improved ID: timestamp + random hex string
        id: Date.now().toString() + Math.random().toString(16).slice(2),
        name: name.trim(),
        text: text.trim(),
        timestamp: new Date().toISOString()
    };

    try {
        await kv.lpush(`comments:${pageId}`, JSON.stringify(newComment));
        // Optional: Trim list if needed
        // await kv.ltrim(`comments:${pageId}`, 0, 99);
        res.status(201).json(newComment);
    } catch (error) {
        console.error(`[API] Error saving comment for pageId ${pageId}:`, error);
        res.status(500).json({ message: 'Internal server error saving comment.' });
    }
});

// GET /api/ratings?pageId=xxx (Added rate limiter, simplified logic)
app.get('/api/ratings', getLimiter, async (req, res) => { // <-- Added getLimiter
    const pageId = req.query.pageId;
    if (!pageId || typeof pageId !== 'string') {
        return res.status(400).json({ message: 'Valid pageId query parameter is required.' });
    }
    console.log(`[API] GET /api/ratings received for pageId: ${pageId}`);

    try {
        const ratingCounts = await kv.hgetall(`ratings:${pageId}`);
        // Pass potentially null ratingCounts directly, helper function handles it
        const stats = calculateRatingStats(ratingCounts);
        res.status(200).json(stats);
    } catch (error) {
        console.error(`[API] Error fetching ratings for pageId ${pageId}:`, error);
        res.status(500).json({ message: 'Internal server error fetching ratings.' });
    }
});

// POST /api/ratings (Validation already improved)
app.post('/api/ratings', ratingLimiter, async (req, res) => {
    const { pageId, rating } = req.body;

    const pageIdError = validateInput(pageId, 'Page ID');
    if (pageIdError) return res.status(400).json({ message: pageIdError });

    if (typeof rating !== 'number' || !Number.isInteger(rating) || rating < 1 || rating > 5) {
        return res.status(400).json({ message: 'Rating must be an integer between 1 and 5.' });
    }

    console.log(`[API] POST /api/ratings received for pageId: ${pageId}`);
    const ratingField = String(rating);

    try {
        await kv.hincrby(`ratings:${pageId}`, ratingField, 1);
        const updatedRatingCounts = await kv.hgetall(`ratings:${pageId}`);
        const stats = calculateRatingStats(updatedRatingCounts);
        res.status(201).json(stats);
    } catch (error) {
        console.error(`[API] Error submitting rating for pageId ${pageId}:`, error);
        res.status(500).json({ message: 'Internal server error submitting rating.' });
    }
});

// --- Removed Debug API Endpoint ---
// app.get('/api/debug/view-data', ...) // Removed

// --- Server Export ---
export default app;
