const express= require('express');
const router = express.Router();
const pool =require('../db/pool');

//Given a score row and its category's config, return the fairness-scaled score
// total * (normal criteria count/criteria actually rated).

function computeScaledScore(scoreRow, categoryConfig) {
    const ratedCount =Object.keys(scoreRow.criteria ||{} ).length;
    if(ratedCount === 0) return 0;
    const normalCount =categoryConfig?categoryConfig.rubric.criteria.length :ratedCount;
    console.log('INSIDE FUNCTION:', { total: scoreRow.total, normalCount, ratedCount });
    return scoreRow.total*(normalCount/ratedCount);
}

router.get('/',async(req,res)=>{
    try{
        const scoresResult = await pool.query('SELECT * FROM scores');
        const presentationsResult =await pool.query('SELECT * FROM presentations');
        const configResult =await pool.query('SELECT * FROM symposium_config LIMIT 1');
      
        const scores=scoresResult.rows;
        const presentationsById ={};
        presentationsResult.rows.forEach((p)=>{
            presentationsById[p.id]=p;
        });

        const config =configResult.rows.length>0?configResult.rows[0].config : {categories:[]};

        //Group scaled scores by presentation.
        const groups={};
        scores.forEach((score)=>{
            const presentation =presentationsById[score.presentation_id];
            if(!presentation) return;

            const categoryConfig =config.categories.find((c)=>c.name===presentation.category);
            const scaled =computeScaledScore(score, categoryConfig);
            console.log('DEBUG:', { total: score.total, ratedCount: Object.keys(score.criteria || {}).length, categoryConfig: !!categoryConfig, scaled });

            const key=presentation.id;
            if(!groups[key]){
                groups[key]={
                    presentationId:presentation.id,
                    presentationNumber:presentation.presentation_Number,
                    timeSlot:presentation.time_Slot,
                    category:presentation.category,
                    discipline:presentation.discipline,
                    scaledScores: [],
                };
            }
            groups[key].scaledScores.push(scaled);

        });

        const leaderboard={};
        Object.values(groups).forEach((group)=>{
            const average=group.scaledScores.reduce((a,b)=>a+b,0)/group.scaledScores.length;
            if(!leaderboard[group.category]) leaderboard[group.category]=[];
            leaderboard[group.category].push({
                presentationNumber:group.presentationNumber,
                timeSlot: group.timeSlot,
                discipline: group.discipline,
                averageScaledScore: average,
                judgeCount:group.scaledScores.length,
            });
        });

        Object.keys(leaderboard).forEach((category)=>{
            leaderboard[category].sort((a,b)=>b.averageScaledScore-a.averageScaledScore);
            leaderboard[category]=leaderboard[category].slice(0,5);
        });
        res.json(leaderboard);
    } catch(err){
        res.status(500).send(`Failed to build leaderboard: ${err.message}`);
    }
});

module.exports=router;