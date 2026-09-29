const express =require('express');
const router =express.Router();
const pool =require('../db/pool');

function sumCriteria(criteria){
    return Object.values(criteria || {}).reduce((sum,v) => sum + (Number(v)||0),0); 
}

function getRequiredCriteriaIds(config, categoryName, includesAbstract){
    const category =config.categories.find((c)=>c.name===categoryName);
    if(!category) return [];

    const ids =category.rubric.criteria.map((c)=>c.id);
    if(includesAbstract && category.abstractCriterion){
        ids.push(category.abstractCriterion.id);
    }
    return ids;
}
router.post('/',async (req,res)=>{
    const {judge_id, presentation_id, criteria, open_ended_answers,includes_abstract}=req.body;

    if(!judge_id || !presentation_id || !criteria ||Object.keys(criteria).length===0){
        return res.status(400).send('judge_id,presentation_id, and at least one criterion are required.');
    
    }

    try {
        const judgeCheck =await pool.query('SELECT * FROM judges WHERE id =$1',[judge_id]);
        if(judgeCheck.rows.length===0){
            return res.status(404).send('NO judge found with that judge_id');
        }

        const presentationCheck =await pool.query('SELECT * FROM presentations WHERE id =$1',[presentation_id]);
        if(presentationCheck.rows.length===0){
            return res.status(404).send('NO presentation found with that presentation_id.');
        }
        const presentation = presentationCheck.rows[0];

        const configResult =await pool.query('SELECT * FROM symposium_config LIMIT 1');
        if (configResult.rows.length>0){
            const config =configResult.rows[0].config;
            const requiredIds =getRequiredCriteriaIds(config, presentation.category, includes_abstract || false);
            const missingids =requiredIds.filter((id)=> !(id in criteria));
            if(missingids.length>0){
                return res.status(400).send(`Missing required criteria: ${missingids.join(', ')}`);
            }
        }

        const existingScore =await pool.query(
            'SELECT * FROM scores WHERE judge_id =$1 AND presentation_id =$2',[judge_id,presentation_id]
        );
        if(existingScore.rows.length>0){
            return res.status(409).send('you have already scored this presentation');
        }

        const total =sumCriteria(criteria);

        const result =await pool.query(
            'INSERT INTO scores (judge_id, presentation_id,criteria, open_ended_answers,includes_abstract,total) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',[judge_id,presentation_id,criteria,open_ended_answers|| {}, includes_abstract||false, total]
        );

        res.status(201).json(result.rows[0]);
    }catch(err){
        res.status(500).send(`Failed to create score: ${err.message}`);
    }

});

router.get('/',async (req,res)=>{
    try{
        const result =await pool.query('SELECT * FROM scores ORDER BY submitted_at DESC');
        res.json(result.rows);
    }catch(err){
        res.status(500).send(`failed to fetch scores: ${err.message}`);
    }
});

module.exports=router;