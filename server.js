const express =require('express');
const pool =require('./db/pool');
const judgesRouter =require('./routes/judges');
const presentationRouter =require('./routes/presentations');
const scoresRouter=require('./routes/scores');
const configRouter = require('./routes/config');
const leaderboardRouter=require('./routes/leaderboard');

const app =express();
const PORT =3000;

app.use(express.json());
app.use('/api/judges',judgesRouter);
app.use('/api/presentations',presentationRouter);
app.use('/api/leaderboard',leaderboardRouter);
app.use('/api/config',configRouter);
app.use('/api/scores',scoresRouter);

app.get('/',(req,res)=>{
    res.send(`Server is alive!`);
});

app.get('/test-db',async(req,res)=>{
    try{
        const result =await pool.query('SELECT NOW()');
        res.send(`Database connected! Current time: ${result.rows[0].now}`);

    } catch (err) {
        res.status(500).send(`Database connection failed: ${err.message}`);
    }
});

app.listen(PORT, ()=>{
    console.log(`Server running at http://localhost:${PORT}`);
});