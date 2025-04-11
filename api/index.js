import { kv } from "@vercel/kv"; // 1. Import Vercel KV client
import cors from "cors";
import express from "express";
import rateLimit from "express-rate-limit";

console.log("[API] server.js loaded successfully."); // <-- 添加日志 1: 文件加载

const app = express();
const PORT = process.env.PORT || 3000;

// 配置 Express 信任代理 (例如 Vercel, Nginx 等)
// '1' 表示信任直接连接的代理
app.set('trust proxy', 1);

// --- CORS Configuration --- (Keep this)
const allowedOrigins = [
    'http://localhost:5173',
    'https://escape-road-online.com'
];
const corsOptions = {
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  }
};
app.use(cors(corsOptions));
app.use(express.json());

// --- Rate Limiters (Keep these) ---
const keyGenerator = (req /*, res */) => {
    const pageId = req.body?.pageId || req.query.pageId || 'unknown_page'; // 尝试从 body 或 query 获取 pageId
    return `${req.ip}-${pageId}`;
};
const commentLimiter = rateLimit({
	windowMs: 1 * 60 * 1000, // 1 minute
	max: 1,
    keyGenerator: keyGenerator, // 应用自定义 key 生成器
	handler: (req, res, next, options) => {
		res.status(options.statusCode).json({ message: options.message });
    },
    message: 'You can only post one comment per game every minute. Please try again later.', // 更新提示信息
    standardHeaders: true,
	legacyHeaders: false,
});

const ratingLimiter = rateLimit({
	windowMs: 1 * 60 * 1000, // 1 minute
	max: 1,
    keyGenerator: keyGenerator, // 应用自定义 key 生成器
	handler: (req, res, next, options) => {
		res.status(options.statusCode).json({ message: options.message });
    },
	message: 'You can only submit one rating per game every minute. Please try again later.', // 更新提示信息
    standardHeaders: true,
	legacyHeaders: false,
});

// --- Helper Functions (Keep these) ---
const initializeRatingCounts = () => ({ '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 });

// 计算评分统计 (保持)
const calculateRatingStats = (ratingCounts) => {
    let sum = 0;
    let count = 0;
    // 确保 ratingCounts 是对象
    ratingCounts = (typeof ratingCounts === 'object' && ratingCounts !== null) ? ratingCounts : {};
    for (let i = 1; i <= 5; i++) {
        const key = i.toString();
        const numRatings = parseInt(ratingCounts[key] || 0, 10); // 确保是数字
        sum += numRatings * i;
        count += numRatings;
    }
    // 处理分母为0的情况，返回5.0
    const average = count > 0 ? sum / count : 5.0; 
    return { average: parseFloat(average.toFixed(1)), count };
};

// --- Public API Routes (使用 Vercel KV 重写) ---

// GET /api/comments?pageId=xxx
app.get('/api/comments', async (req, res) => {
    console.log(`[API] GET /api/comments received for pageId: ${req.query.pageId}`); // <-- 添加日志 2: 路由进入
    const pageId = req.query.pageId;
    if (!pageId) {
        return res.status(400).json({ message: 'pageId is required' });
    }

    try {
        // 使用 Vercel KV 的 LRANGE 命令获取评论列表 (假设评论存储在名为 `comments:${pageId}` 的 List 中)
        // 0 -1 表示获取所有元素
        const commentsJson = await kv.lrange(`comments:${pageId}`, 0, -1);
        // Vercel KV 返回的是 JSON 字符串数组，需要解析
        const comments = commentsJson.map(jsonString => JSON.parse(jsonString));
        // comments 已经是按插入顺序（最新在前）排列
        res.json(comments || []); // 如果列表不存在或为空，返回空数组
    } catch (error) {
        console.error('Error fetching comments from Vercel KV:', error);
        res.status(500).json({ message: 'Error fetching comments' });
    }
});

// POST /api/comments
app.post('/api/comments', commentLimiter, async (req, res) => {
    console.log(`[API] POST /api/comments received for pageId: ${req.body.pageId}`); // <-- 添加日志 3: 路由进入
    // 不再需要 email，移除相关验证
    const { pageId, name, text } = req.body;

    // --- 简化输入验证 ---
    if (!pageId || !name || !text) {
        return res.status(400).json({ message: 'pageId, name, and text are required' });
    }
    if (typeof name !== 'string' || name.trim() === '') {
         return res.status(400).json({ message: 'Name cannot be empty' });
    }
    if (typeof text !== 'string' || text.trim() === '') {
        return res.status(400).json({ message: 'Comment text cannot be empty' });
    }
    if (name.trim().length > 100) {
         return res.status(400).json({ message: 'Name is too long (max 100 characters)' });
    }
    if (text.trim().length > 500) {
         return res.status(400).json({ message: 'Comment is too long (max 500 characters)' });
    }
    // --- 验证结束 ---

    const newComment = {
        id: Date.now().toString(), 
        name: name.trim(),
        text: text.trim(),
        timestamp: new Date().toISOString()
    };

    try {
        // 使用 Vercel KV 的 LPUSH 命令将新评论添加到列表的开头
        // 需要将评论对象序列化为 JSON 字符串存储
        await kv.lpush(`comments:${pageId}`, JSON.stringify(newComment));
        // 可选：限制列表长度，例如只保留最新的 100 条评论
        // await kv.ltrim(`comments:${pageId}`, 0, 99);
        
        res.status(201).json(newComment); // 返回新评论对象 (已不含 email)
    } catch (error) {
        console.error('Error saving comment to Vercel KV:', error);
        res.status(500).json({ message: 'Error saving comment' });
    }
});

// GET /api/ratings?pageId=xxx
app.get('/api/ratings', async (req, res) => {
    console.log(`[API] GET /api/ratings received for pageId: ${req.query.pageId}`); // <-- 添加日志 4: 路由进入
    const pageId = req.query.pageId;
    if (!pageId) {
        return res.status(400).json({ message: 'pageId is required' });
    }
    try {
        // 使用 Vercel KV 的 HGETALL 命令获取评分计数 (假设存储在名为 `ratings:${pageId}` 的 Hash 中)
        const ratingCounts = await kv.hgetall(`ratings:${pageId}`);
        // HGETALL 返回的对象，值是字符串，需要确保 calculateRatingStats 能处理
        const stats = calculateRatingStats(ratingCounts || initializeRatingCounts()); 
        res.json(stats);
    } catch (error) {
        console.error('Error fetching ratings from Vercel KV:', error);
        res.status(500).json({ message: 'Error fetching ratings' });
    }
});

// POST /api/ratings 
app.post('/api/ratings', ratingLimiter, async (req, res) => { 
    console.log(`[API] POST /api/ratings received for pageId: ${req.body.pageId}`); // <-- 添加日志 5: 路由进入
    const { pageId, rating } = req.body; 
    if (!pageId || typeof rating !== 'number' || rating < 1 || rating > 5) {
        return res.status(400).send('pageId and a rating (1-5) are required.');
    }
    const ratingField = rating.toString(); // '1', '2', ..., '5'

    try {
        // 使用 Vercel KV 的 HINCRBY 命令原子性地增加对应星级的计数
        // HINCRBY 会自动创建 Hash (如果不存在) 并将字段初始化为 0 再增加
        await kv.hincrby(`ratings:${pageId}`, ratingField, 1);

        // 获取更新后的所有评分计数
        const updatedRatingCounts = await kv.hgetall(`ratings:${pageId}`);
        // 计算并返回最新的统计信息
        const stats = calculateRatingStats(updatedRatingCounts || initializeRatingCounts());
        res.status(201).json(stats);
    } catch (error) {
        console.error('Error submitting rating to Vercel KV:', error);
        res.status(500).send('Error submitting rating');
    }
});

// --- 启动服务器 (注释掉或删除，Vercel不需要) ---
// app.listen(PORT, '0.0.0.0', () => {
//     console.log(`Server listening on port ${PORT}.`);
// });

// 添加导出语句，以便 Vercel 可以导入 app
export default app;
