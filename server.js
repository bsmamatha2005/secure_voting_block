require("dotenv").config();
const path = require("path");
const crypto = require("crypto");
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const jwt = require("jsonwebtoken");
const sqlite3 = require("sqlite3").verbose();

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "replace-this-in-production";
const OTP_TTL_MS = 5 * 60 * 1000;
const RESULT_REVEAL_DELAY_MS = 5 * 60 * 1000;
const FINAL_COUNT_REVEAL_DELAY_MS = 15 * 60 * 1000;
const AADHAAR_PEPPER = process.env.AADHAAR_PEPPER || JWT_SECRET;
const ELECTION_MAP = {
  Maharashtra: ["Mumbai South", "Pune Central"],
  Karnataka: ["Bengaluru North", "Mysuru Urban"],
  Gujarat: ["Ahmedabad East", "Surat West"],
  Rajasthan: ["Jaipur City", "Udaipur Rural"],
  "Uttar Pradesh": ["Lucknow Central", "Varanasi North"],
};

app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const db = new sqlite3.Database(path.join(__dirname, "voting.db"));

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) {
        reject(err);
        return;
      }
      resolve(this);
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(row);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(rows);
    });
  });
}

function sha256(input) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function aadhaarHash(aadhaar) {
  return crypto
    .createHmac("sha256", AADHAAR_PEPPER)
    .update(String(aadhaar))
    .digest("hex");
}

function computeAgeFromDob(dobIso) {
  const dob = new Date(dobIso);
  if (Number.isNaN(dob.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - dob.getFullYear();
  const m = today.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) age -= 1;
  return age;
}

function generateVoterIdFromAadhaarHash(hash) {
  return `ADH${hash.slice(0, 4).toUpperCase()}${hash.slice(-4).toUpperCase()}`;
}

async function initDb() {
  try {
    await run("ALTER TABLE candidates ADD COLUMN constituency TEXT");
  } catch (error) {
    // Column already exists in most runs.
  }
  try {
    await run("ALTER TABLE candidates ADD COLUMN state TEXT");
  } catch (error) {
    // Column already exists in most runs.
  }
  try {
    await run("ALTER TABLE voter_registry ADD COLUMN state TEXT");
  } catch (error) {
    // Column already exists in most runs.
  }
  try {
    await run("ALTER TABLE voter_registry ADD COLUMN constituency TEXT");
  } catch (error) {
    // Column already exists in most runs.
  }
  try {
    await run("ALTER TABLE voter_registry ADD COLUMN aadhaar_hash TEXT");
  } catch (error) {
    // Column already exists in most runs.
  }
  try {
    await run("ALTER TABLE voter_registry ADD COLUMN dob TEXT");
  } catch (error) {
    // Column already exists in most runs.
  }

  await run(
    `CREATE TABLE IF NOT EXISTS candidates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      party TEXT NOT NULL,
      constituency TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'Maharashtra'
    )`
  );

  await run(
    `CREATE TABLE IF NOT EXISTS blockchain (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      block_index INTEGER NOT NULL,
      timestamp TEXT NOT NULL,
      voter_id INTEGER NOT NULL,
      candidate_id INTEGER NOT NULL,
      previous_hash TEXT NOT NULL,
      nonce INTEGER NOT NULL,
      hash TEXT NOT NULL,
      FOREIGN KEY(candidate_id) REFERENCES candidates(id)
    )`
  );

  await run(
    `CREATE TABLE IF NOT EXISTS voter_registry (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      voter_id TEXT UNIQUE NOT NULL,
      full_name TEXT NOT NULL,
      has_voted INTEGER DEFAULT 0,
      state TEXT NOT NULL DEFAULT 'Maharashtra',
      constituency TEXT NOT NULL DEFAULT 'Mumbai South',
      aadhaar_hash TEXT,
      dob TEXT
    )`
  );

  await run(
    `CREATE TABLE IF NOT EXISTS otp_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      voter_id TEXT NOT NULL,
      otp_code TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    )`
  );

  await run("DELETE FROM otp_sessions WHERE expires_at < ?", [Date.now()]);
  await run(
    "UPDATE candidates SET constituency = COALESCE(constituency, 'North City') WHERE constituency IS NULL OR constituency = ''"
  );
  await run(
    "UPDATE candidates SET state = COALESCE(state, 'Maharashtra') WHERE state IS NULL OR state = ''"
  );
  await run(
    "UPDATE voter_registry SET state = COALESCE(state, 'Maharashtra') WHERE state IS NULL OR state = ''"
  );
  await run(
    "UPDATE voter_registry SET constituency = COALESCE(constituency, 'Mumbai South') WHERE constituency IS NULL OR constituency = ''"
  );
  await run(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_voter_aadhaar_hash ON voter_registry(aadhaar_hash)"
  );

  const registryCount = await get("SELECT COUNT(*) AS total FROM voter_registry");
  if (!registryCount || registryCount.total === 0) {
    const members = [
      ["VTR1001", "Aarav Sharma", "Maharashtra", "Mumbai South"],
      ["VTR1002", "Isha Verma", "Maharashtra", "Pune Central"],
      ["VTR1003", "Rohan Mehta", "Karnataka", "Bengaluru North"],
      ["VTR1004", "Neha Kapoor", "Karnataka", "Mysuru Urban"],
      ["VTR1005", "Vivaan Gupta", "Gujarat", "Ahmedabad East"],
      ["VTR1006", "Ananya Patel", "Gujarat", "Surat West"],
      ["VTR1007", "Kabir Singh", "Rajasthan", "Jaipur City"],
      ["VTR1008", "Diya Nair", "Rajasthan", "Udaipur Rural"],
      ["VTR1009", "Arjun Rao", "Uttar Pradesh", "Lucknow Central"],
      ["VTR1010", "Saanvi Desai", "Uttar Pradesh", "Varanasi North"],
      ["VTR1011", "Reyansh Malhotra", "Maharashtra", "Mumbai South"],
      ["VTR1012", "Aditi Joshi", "Maharashtra", "Pune Central"],
      ["VTR1013", "Krish Bhatia", "Karnataka", "Bengaluru North"],
      ["VTR1014", "Myra Chawla", "Gujarat", "Ahmedabad East"],
      ["VTR1015", "Advait Saxena", "Rajasthan", "Jaipur City"],
    ];
    for (const member of members) {
      await run(
        "INSERT INTO voter_registry (voter_id, full_name, has_voted, state, constituency) VALUES (?, ?, 0, ?, ?)",
        member
      );
    }
  }

  const parties = [
    "Democratic Alliance",
    "Jan Shakti Party",
    "People First Front",
    "National Reform Party",
    "Development Congress",
  ];
  for (const [state, constituencies] of Object.entries(ELECTION_MAP)) {
    for (const constituency of constituencies) {
      const existingCount = await get(
        "SELECT COUNT(*) AS total FROM candidates WHERE state = ? AND constituency = ?",
        [state, constituency]
      );
      for (let idx = existingCount.total; idx < 5; idx += 1) {
        const number = idx + 1;
        const candidateName = `${constituency} Candidate ${number}`;
        await run(
          "INSERT INTO candidates (name, party, constituency, state) VALUES (?, ?, ?, ?)",
          [candidateName, parties[idx % parties.length], constituency, state]
        );
      }
    }
  }

  const chainCount = await get("SELECT COUNT(*) AS total FROM blockchain");
  if (!chainCount || chainCount.total === 0) {
    const timestamp = new Date().toISOString();
    const genesisPayload = `0|${timestamp}|0|0|0|GENESIS`;
    const genesisHash = sha256(genesisPayload);
    await run(
      `INSERT INTO blockchain
      (block_index, timestamp, voter_id, candidate_id, previous_hash, nonce, hash)
      VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [0, timestamp, 0, 0, "0".repeat(64), 0, genesisHash]
    );
  }
}

function signToken(user) {
  return jwt.sign(
    {
      id: user.id,
      voterId: user.voter_id,
      fullName: user.full_name,
      state: user.state,
      constituency: user.constituency,
    },
    JWT_SECRET,
    { expiresIn: "8h" }
  );
}

function auth(req, res, next) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7)
    : null;

  if (!token) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    res.status(401).json({ message: "Invalid token" });
  }
}

async function createBlock(voterId, candidateId) {
  const lastBlock = await get(
    "SELECT * FROM blockchain ORDER BY block_index DESC LIMIT 1"
  );

  const blockIndex = lastBlock.block_index + 1;
  const timestamp = new Date().toISOString();
  const previousHash = lastBlock.hash;
  let nonce = 0;
  let hash = "";

  do {
    const payload = `${blockIndex}|${timestamp}|${voterId}|${candidateId}|${previousHash}|${nonce}`;
    hash = sha256(payload);
    nonce += 1;
  } while (!hash.startsWith("000"));

  await run(
    `INSERT INTO blockchain
    (block_index, timestamp, voter_id, candidate_id, previous_hash, nonce, hash)
    VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [blockIndex, timestamp, voterId, candidateId, previousHash, nonce, hash]
  );
}

app.post("/api/member/request-otp", async (req, res) => {
  try {
    const { voterId, fullName } = req.body;
    if (!voterId || !fullName) {
      res.status(400).json({ message: "Voter ID and name are required" });
      return;
    }

    const user = await get(
      "SELECT * FROM voter_registry WHERE voter_id = ? AND LOWER(full_name) = ?",
      [String(voterId).trim().toUpperCase(), String(fullName).trim().toLowerCase()]
    );
    if (!user) {
      res.status(404).json({
        message: "Voter not found in registry. Please verify with Aadhaar + OTP.",
        code: "VOTER_NOT_FOUND",
        requireAadhaar: true,
      });
      return;
    }

    if (user.has_voted) {
      res.status(409).json({ message: "This voter has already cast the vote" });
      return;
    }

    const otp = String(Math.floor(100000 + Math.random() * 900000));
    await run("DELETE FROM otp_sessions WHERE voter_id = ?", [user.voter_id]);
    await run(
      "INSERT INTO otp_sessions (voter_id, otp_code, expires_at) VALUES (?, ?, ?)",
      [user.voter_id, otp, Date.now() + OTP_TTL_MS]
    );

    res.json({
      message: "Demo OTP generated successfully",
      demoOtp: otp,
    });
  } catch (error) {
    res.status(500).json({ message: "Failed to generate OTP" });
  }
});

app.post("/api/aadhaar/request-otp", async (req, res) => {
  try {
    const { fullName, aadhaar, dob } = req.body;
    if (!fullName || !aadhaar || !dob) {
      res.status(400).json({ message: "Full name, Aadhaar and Date of Birth are required" });
      return;
    }

    const age = computeAgeFromDob(String(dob).trim());
    if (age === null) {
      res.status(400).json({ message: "Invalid Date of Birth" });
      return;
    }
    if (age < 18) {
      res.status(403).json({ message: "Not eligible to vote (must be 18+)" });
      return;
    }

    const hash = aadhaarHash(String(aadhaar).trim());
    let user = await get("SELECT * FROM voter_registry WHERE aadhaar_hash = ?", [hash]);
    if (user && user.has_voted) {
      res.status(409).json({ message: "Duplicate voting blocked (Aadhaar already voted)" });
      return;
    }

    if (!user) {
      const voterId = generateVoterIdFromAadhaarHash(hash);
      // Default assignment for newly verified voters (can be enhanced later).
      await run(
        "INSERT INTO voter_registry (voter_id, full_name, has_voted, state, constituency, aadhaar_hash, dob) VALUES (?, ?, 0, ?, ?, ?, ?)",
        [voterId, String(fullName).trim(), "Maharashtra", "Mumbai South", hash, String(dob).trim()]
      );
      user = await get("SELECT * FROM voter_registry WHERE aadhaar_hash = ?", [hash]);
    } else {
      await run(
        "UPDATE voter_registry SET full_name = COALESCE(NULLIF(full_name, ''), ?), dob = COALESCE(NULLIF(dob, ''), ?) WHERE id = ?",
        [String(fullName).trim(), String(dob).trim(), user.id]
      );
      user = await get("SELECT * FROM voter_registry WHERE id = ?", [user.id]);
    }

    const otp = String(Math.floor(100000 + Math.random() * 900000));
    await run("DELETE FROM otp_sessions WHERE voter_id = ?", [user.voter_id]);
    await run(
      "INSERT INTO otp_sessions (voter_id, otp_code, expires_at) VALUES (?, ?, ?)",
      [user.voter_id, otp, Date.now() + OTP_TTL_MS]
    );

    res.json({
      message: "Demo OTP generated successfully",
      voterId: user.voter_id,
      demoOtp: otp,
    });
  } catch (error) {
    if (String(error?.message || "").includes("UNIQUE") || String(error?.message || "").includes("constraint")) {
      res.status(409).json({ message: "Duplicate Aadhaar blocked" });
      return;
    }
    res.status(500).json({ message: "Failed to generate OTP" });
  }
});

app.post("/api/member/verify-otp", async (req, res) => {
  try {
    const { voterId, otp } = req.body;
    if (!voterId || !otp) {
      res.status(400).json({ message: "Voter ID and OTP are required" });
      return;
    }

    const registry = await get("SELECT * FROM voter_registry WHERE voter_id = ?", [
      String(voterId).trim().toUpperCase(),
    ]);
    if (!registry) {
      res.status(404).json({ message: "Voter not found" });
      return;
    }

    if (registry.has_voted) {
      res.status(409).json({ message: "This voter has already cast the vote" });
      return;
    }

    const session = await get(
      "SELECT * FROM otp_sessions WHERE voter_id = ? ORDER BY id DESC LIMIT 1",
      [registry.voter_id]
    );
    if (!session || session.expires_at < Date.now()) {
      res.status(401).json({ message: "OTP expired. Generate a new OTP." });
      return;
    }

    if (session.otp_code !== String(otp).trim()) {
      res.status(401).json({ message: "Invalid OTP" });
      return;
    }

    await run("DELETE FROM otp_sessions WHERE voter_id = ?", [registry.voter_id]);

    const token = signToken(registry);
    res.json({ token, voter: registry });
  } catch (error) {
    res.status(500).json({ message: "OTP verification failed" });
  }
});

app.get("/api/me", auth, async (req, res) => {
  try {
    const user = await get(
      "SELECT id, voter_id, full_name, has_voted, state, constituency FROM voter_registry WHERE id = ?",
      [req.user.id]
    );
    if (!user) {
      res.status(404).json({ message: "User not found" });
      return;
    }
    res.json({ user });
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch user" });
  }
});

app.get("/api/candidates", auth, async (req, res) => {
  const user = await get(
    "SELECT state, constituency FROM voter_registry WHERE id = ?",
    [req.user.id]
  );
  if (!user) {
    res.status(404).json({ message: "User not found" });
    return;
  }

  const candidates = await all(
    "SELECT id, name, party, constituency, state FROM candidates WHERE state = ? AND constituency = ? ORDER BY id",
    [user.state, user.constituency]
  );
  res.json({ state: user.state, constituency: user.constituency, candidates });
});

app.post("/api/vote", auth, async (req, res) => {
  try {
    const { candidateId } = req.body;
    if (!candidateId) {
      res.status(400).json({ message: "Candidate is required" });
      return;
    }

    const user = await get(
      "SELECT id, has_voted, state, constituency FROM voter_registry WHERE id = ?",
      [req.user.id]
    );
    if (!user) {
      res.status(404).json({ message: "User not found" });
      return;
    }
    if (user.has_voted) {
      res.status(409).json({ message: "You have already voted" });
      return;
    }

    const candidate = await get(
      "SELECT id FROM candidates WHERE id = ? AND constituency = ? AND state = ?",
      [candidateId, user.constituency, user.state]
    );
    if (!candidate) {
      res
        .status(404)
        .json({ message: "Candidate not found for your constituency" });
      return;
    }

    await createBlock(user.id, candidate.id);
    await run("UPDATE voter_registry SET has_voted = 1 WHERE id = ?", [user.id]);
    const revealAt = new Date(Date.now() + RESULT_REVEAL_DELAY_MS).toISOString();
    res.json({
      message: "Vote cast successfully and block mined",
      revealAt,
    });
  } catch (error) {
    res.status(500).json({ message: "Failed to cast vote" });
  }
});

app.get("/api/blockchain", auth, async (req, res) => {
  const revealCutoff = new Date(Date.now() - RESULT_REVEAL_DELAY_MS).toISOString();
  const pending = await get(
    "SELECT COUNT(*) AS total FROM blockchain WHERE block_index > 0 AND timestamp > ?",
    [revealCutoff]
  );
  if (pending && pending.total > 0) {
    const latestPending = await get(
      "SELECT MIN(timestamp) AS earliest_pending FROM blockchain WHERE block_index > 0 AND timestamp > ?",
      [revealCutoff]
    );
    const revealAt = new Date(
      new Date(latestPending.earliest_pending).getTime() + RESULT_REVEAL_DELAY_MS
    ).toISOString();
    res.json({
      locked: true,
      revealAt,
      message: "Blockchain and hashes unlock 5 minutes after vote recording.",
      blocks: [],
    });
    return;
  }

  const blocks = await all(
    `SELECT
      b.block_index,
      b.timestamp,
      b.previous_hash,
      b.hash,
      b.nonce,
      COALESCE(vr.full_name, 'GENESIS') AS voter_name,
      COALESCE(c.name, 'GENESIS') AS candidate_name,
      COALESCE(c.constituency, '-') AS constituency,
      COALESCE(c.state, '-') AS state
    FROM blockchain b
    LEFT JOIN voter_registry vr ON vr.id = b.voter_id
    LEFT JOIN candidates c ON c.id = b.candidate_id
    WHERE b.block_index = 0 OR b.timestamp <= ?
    ORDER BY b.block_index ASC`,
    [revealCutoff]
  );
  res.json({ locked: false, blocks });
});

app.get("/api/results", auth, async (req, res) => {
  const firstVote = await get(
    "SELECT MIN(timestamp) AS first_vote_at FROM blockchain WHERE block_index > 0"
  );
  if (firstVote && firstVote.first_vote_at) {
    const revealAt = new Date(
      new Date(firstVote.first_vote_at).getTime() + FINAL_COUNT_REVEAL_DELAY_MS
    );
    if (Date.now() < revealAt.getTime()) {
      res.json({
        locked: true,
        revealAt: revealAt.toISOString(),
        message: "Final count dashboard unlocks 15 minutes after voting starts.",
        results: [],
        totalVotes: 0,
      });
      return;
    }
  }

  const results = await all(
    `SELECT c.id, c.name, c.party, c.state, c.constituency, COUNT(b.id) AS votes
     FROM candidates c
     LEFT JOIN blockchain b ON b.candidate_id = c.id
       AND b.block_index > 0
       AND b.timestamp IS NOT NULL
     GROUP BY c.id, c.name, c.party, c.state, c.constituency
     ORDER BY votes DESC, c.id ASC`,
    []
  );
  const total = await get(
    "SELECT COUNT(*) AS totalVotes FROM blockchain WHERE block_index > 0"
  );
  res.json({ locked: false, results, totalVotes: total.totalVotes });
});

app.get("/api/results-lock", auth, async (req, res) => {
  const firstVote = await get(
    "SELECT MIN(timestamp) AS first_vote_at FROM blockchain WHERE block_index > 0"
  );
  if (!firstVote || !firstVote.first_vote_at) {
    res.json({
      locked: true,
      revealAt: null,
      message: "Final count appears 15 minutes after first vote is cast.",
    });
    return;
  }
  const revealAt = new Date(
    new Date(firstVote.first_vote_at).getTime() + FINAL_COUNT_REVEAL_DELAY_MS
  );
  res.json({
    locked: Date.now() < revealAt.getTime(),
    revealAt: revealAt.toISOString(),
    message: "Final count dashboard unlocks 15 minutes after voting starts.",
  });
});

app.get(/.*/, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Voting app running at http://localhost:${PORT}`);
    });
  })
  .catch((error) => {
    console.error("Database initialization failed:", error);
    process.exit(1);
  });
