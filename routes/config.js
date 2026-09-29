const express =require('express');
const router =express.Router();
const pool =require('../db/pool');

//GET /api/config return the current config. If no config row exists yet, returns null

router.get('/',async (req,res)=>{
    try{
        const result =await pool.query('SELECT * FROM symposium_config LIMIT 1');
        if(result.rows.length===0){
            return res.json(null);
        }
        res.json(result.rows[0]);
    }catch (err) {
        res.status(500).send(`Failed to fetch config: ${err.message}`);
    }
});

module.exports=router;