const express = require('express');
const router = express.Router();
const pool = require('../db/pool');


//POST /api/judges -create a new judge or return the existing one if the code already exists

router.post('/',async(req,res)=>{
    const {code, first_name, last_name} =req.body;
    if(!code || !first_name || !last_name){
        return res.status(400).send('code,first_name, and last name are all required.');
    }
    try{
        const existing = await pool.query('SELECT * FROM judges WHERE code =$1',[code]);
        if(existing.rows.length>0){
            return res.json(existing.rows[0]);
        }

        const result =await pool.query(
            'INSERT INTO judges (code,first_name,last_name) VALUES ($1,$2,$3) Returning *', [code, first_name, last_name]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        res.status(500).send(`Error creating judge: ${err.message}`);
    }
});

router.get('/',async (req,res)=>{
    try{
        const result =await pool.query('SELECT * FROM judges ORDER BY id DESC');
        res.json(result.rows);
    }catch(err){
        res.status(500).send(`Failed to fetch judges: ${err.message}`);
    }
})

module.exports =router;