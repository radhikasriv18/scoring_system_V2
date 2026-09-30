const express =require('express');
const router =express.Router();
const pool =require('../db/pool');
const requireAdmin =require('../middleware/requireAdmin');

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

// PUT /api/config — admin-only. Replaces the current config.
router.put('/', requireAdmin, async (req, res) => {
  const { config } = req.body;

  if (!config) {
    return res.status(400).send('config is required.');
  }

  try {
    const existing = await pool.query('SELECT id FROM symposium_config LIMIT 1');

    if (existing.rows.length === 0) {
      const result = await pool.query(
        'INSERT INTO symposium_config (config) VALUES ($1) RETURNING *',
        [config]
      );
      return res.status(201).json(result.rows[0]);
    }

    const result = await pool.query(
      'UPDATE symposium_config SET config = $1 WHERE id = $2 RETURNING *',
      [config, existing.rows[0].id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).send(`Failed to update config: ${err.message}`);
  }
});

module.exports=router;