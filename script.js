const authSection = document.getElementById("authSection");
const dashboardSection = document.getElementById("dashboardSection");
const otpRequestForm = document.getElementById("otpRequestForm");
const otpVerifyForm = document.getElementById("otpVerifyForm");
const authMessage = document.getElementById("authMessage");
const voteMessage = document.getElementById("voteMessage");
const userInfo = document.getElementById("userInfo");
const aadhaarFields = document.getElementById("aadhaarFields");
const otpRequestBtn = document.getElementById("otpRequestBtn");
const aadhaarInput = document.getElementById("aadhaarInput");
const dobInput = document.getElementById("dobInput");
const voterIdInput = document.getElementById("voterId");
const candidateSelect = document.getElementById("candidateSelect");
const candidatePreview = document.getElementById("candidatePreview");
const resultsList = document.getElementById("resultsList");
const blockchainView = document.getElementById("blockchainView");
const totalVotesText = document.getElementById("totalVotes");
const logoutBtn = document.getElementById("logoutBtn");
const backBtn = document.getElementById("backBtn");
const nextBtn = document.getElementById("nextBtn");
const submitVoteBtn = document.getElementById("submitVoteBtn");
const reviewText = document.getElementById("reviewText");
const step1 = document.getElementById("step1");
const step2 = document.getElementById("step2");
const dot1 = document.getElementById("dot1");
const dot2 = document.getElementById("dot2");
const fixedState = document.getElementById("fixedState");
const fixedConstituency = document.getElementById("fixedConstituency");
const tabVote = document.getElementById("tabVote");
const tabResults = document.getElementById("tabResults");
const tabChain = document.getElementById("tabChain");
const pageVote = document.getElementById("pageVote");
const pageResults = document.getElementById("pageResults");
const pageChain = document.getElementById("pageChain");

const tokenKey = "voting_token";
let currentStep = 1;
let currentVoterId = "";
let aadhaarMode = false;

function getToken() {
  return localStorage.getItem(tokenKey);
}

function setToken(token) {
  localStorage.setItem(tokenKey, token);
}

function clearToken() {
  localStorage.removeItem(tokenKey);
}

async function api(path, options = {}) {
  const token = getToken();
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(path, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.message || "Request failed");
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

function showAuth() {
  authSection.classList.remove("hidden");
  dashboardSection.classList.add("hidden");
}

function showDashboard() {
  authSection.classList.add("hidden");
  dashboardSection.classList.remove("hidden");
}

function setActiveTab(tabName) {
  tabVote.classList.toggle("active", tabName === "vote");
  tabResults.classList.toggle("active", tabName === "results");
  tabChain.classList.toggle("active", tabName === "chain");
  pageVote.classList.toggle("hidden", tabName !== "vote");
  pageResults.classList.toggle("hidden", tabName !== "results");
  pageChain.classList.toggle("hidden", tabName !== "chain");
}

async function refreshDashboard() {
  const me = await api("/api/me");
  const candidatesData = await api("/api/candidates");
  const resultsData = await api("/api/results");
  const chainData = await api("/api/blockchain");

  userInfo.textContent = `${me.user.full_name} (${me.user.voter_id})`;
  fixedState.textContent = me.user.state || "-";
  fixedConstituency.textContent = me.user.constituency || "-";

  await loadCandidatesForVoterConstituency(candidatesData);

  if (me.user.has_voted) {
    backBtn.disabled = true;
    nextBtn.disabled = true;
    submitVoteBtn.disabled = true;
    voteMessage.textContent = "You have already voted. Thank you for participation.";
  } else {
    backBtn.disabled = false;
    nextBtn.disabled = false;
    submitVoteBtn.disabled = false;
    voteMessage.textContent = "";
  }

  resultsList.innerHTML = "";
  if (resultsData.locked) {
    const revealTime = resultsData.revealAt
      ? new Date(resultsData.revealAt).toLocaleTimeString()
      : "after first vote starts";
    resultsList.innerHTML = `<div class="result-item"><strong>Results Locked</strong><p>${resultsData.message}</p><p>Visible after: ${revealTime}</p></div>`;
    totalVotesText.textContent = "Total Votes Cast: Hidden until unlock";
  } else {
    resultsData.results.forEach((item) => {
      const div = document.createElement("div");
      div.className = "result-item";
      div.innerHTML = `<strong>${item.name}</strong><span>${item.party}</span><p>Votes: ${item.votes}</p>`;
      resultsList.appendChild(div);
    });
    totalVotesText.textContent = `Total Votes Cast: ${resultsData.totalVotes}`;
  }

  blockchainView.innerHTML = "";
  if (chainData.locked) {
    const revealTime = new Date(chainData.revealAt).toLocaleTimeString();
    blockchainView.innerHTML = `<div class="block"><h4>Blockchain Locked</h4><p>${chainData.message}</p><p><strong>Visible after:</strong> ${revealTime}</p></div>`;
  } else {
    chainData.blocks.forEach((block) => {
      const div = document.createElement("div");
      div.className = "block";
      div.innerHTML = `
      <h4>Block #${block.block_index}</h4>
      <p><strong>Time:</strong> ${new Date(block.timestamp).toLocaleString()}</p>
      <p><strong>Voter:</strong> ${block.voter_name}</p>
      <p><strong>State:</strong> ${block.state}</p>
      <p><strong>Constituency:</strong> ${block.constituency}</p>
      <p><strong>Candidate:</strong> ${block.candidate_name}</p>
      <p><strong>Nonce:</strong> ${block.nonce}</p>
      <p><strong>Previous Hash:</strong></p>
      <p class="hash">${block.previous_hash}</p>
      <p><strong>Hash:</strong></p>
      <p class="hash">${block.hash}</p>
    `;
      blockchainView.appendChild(div);
    });
  }
}

function renderSteps() {
  step1.classList.toggle("hidden", currentStep !== 1);
  step2.classList.toggle("hidden", currentStep !== 2);
  dot1.classList.toggle("active", currentStep === 1);
  dot2.classList.toggle("active", currentStep === 2);
  backBtn.disabled = currentStep === 1;
  nextBtn.classList.toggle("hidden", currentStep === 2);
  submitVoteBtn.classList.toggle("hidden", currentStep !== 2);

  if (currentStep === 2) {
    const state = fixedState.textContent;
    const constituency = fixedConstituency.textContent;
    const candidateName = candidateSelect.options[candidateSelect.selectedIndex]?.textContent;
    reviewText.textContent = `State: ${state}, Constituency: ${constituency}, Candidate: ${candidateName}. Click Submit Vote to confirm.`;
  }
}

function updatePaperBallotSelection() {
  const selectedId = Number(candidateSelect.value);
  const cards = candidatePreview.querySelectorAll(".ballot-row");
  cards.forEach((card) => {
    const candidateId = Number(card.getAttribute("data-candidate-id"));
    const isSelected = candidateId === selectedId;
    card.classList.toggle("selected", isSelected);
    const mark = card.querySelector(".mark");
    if (mark) {
      mark.textContent = isSelected ? "✓" : "○";
    }
  });
}

async function loadCandidatesForVoterConstituency(candidatesData) {
  candidateSelect.innerHTML = "";
  candidatePreview.innerHTML = "";
  (candidatesData.candidates || []).forEach((candidate, idx) => {
    const option = document.createElement("option");
    option.value = candidate.id;
    option.textContent = `${candidate.name} - ${candidate.party}`;
    candidateSelect.appendChild(option);

    const card = document.createElement("button");
    card.type = "button";
    card.className = "ballot-row";
    card.setAttribute("data-candidate-id", String(candidate.id));
    card.innerHTML = `<span class="serial">${idx + 1}</span><div><strong>${candidate.name}</strong><p>${candidate.party}</p></div><span class="mark">○</span>`;
    card.addEventListener("click", () => {
      candidateSelect.value = String(candidate.id);
      updatePaperBallotSelection();
    });
    candidatePreview.appendChild(card);
  });
  updatePaperBallotSelection();
}

otpRequestForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  authMessage.textContent = aadhaarMode
    ? "Verifying eligibility and generating OTP..."
    : "Matching voter ID and name...";
  try {
    const fullName = document.getElementById("memberName").value.trim();
    if (!fullName) throw new Error("Full name is required");

    let data;
    if (aadhaarMode) {
      const aadhaar = String(aadhaarInput.value || "").trim();
      const dob = String(dobInput.value || "").trim();
      if (!aadhaar || aadhaar.length < 8) throw new Error("Aadhaar number is required");
      if (!dob) throw new Error("Date of Birth is required");
      data = await api("/api/aadhaar/request-otp", {
        method: "POST",
        body: JSON.stringify({ fullName, aadhaar, dob }),
      });
      currentVoterId = data.voterId;
    } else {
      const voterId = String(voterIdInput.value || "").trim().toUpperCase();
      if (!voterId) throw new Error("Voter ID is required");
      data = await api("/api/member/request-otp", {
        method: "POST",
        body: JSON.stringify({ fullName, voterId }),
      });
      currentVoterId = voterId;
    }

    otpVerifyForm.classList.remove("hidden");
    authMessage.textContent = `Demo OTP generated: ${data.demoOtp}`;
  } catch (error) {
    if (error?.data?.requireAadhaar) {
      aadhaarMode = true;
      aadhaarFields.classList.remove("hidden");
      voterIdInput.disabled = true;
      voterIdInput.value = "";
      voterIdInput.placeholder = "Not required for Aadhaar verification";
      otpRequestBtn.textContent = "Generate OTP with Aadhaar";
      authMessage.textContent =
        "Voter not found in list. Please enter Aadhaar + DOB to verify (18+).";
      return;
    }
    authMessage.textContent = error.message;
  }
});

otpVerifyForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  authMessage.textContent = "Verifying OTP...";
  try {
    const payload = {
      voterId: currentVoterId,
      otp: document.getElementById("otpInput").value.trim(),
    };
    const data = await api("/api/member/verify-otp", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    setToken(data.token);
    showDashboard();
    setActiveTab("vote");
    await refreshDashboard();
    currentStep = 1;
    renderSteps();
  } catch (error) {
    authMessage.textContent = error.message;
  }
});

candidateSelect.addEventListener("change", () => {
  updatePaperBallotSelection();
});

backBtn.addEventListener("click", () => {
  if (currentStep > 1) {
    currentStep -= 1;
    renderSteps();
  }
});

nextBtn.addEventListener("click", async () => {
  if (currentStep < 2) {
    currentStep += 1;
    renderSteps();
  }
});

submitVoteBtn.addEventListener("click", async () => {
  voteMessage.textContent = "Mining vote block...";
  try {
    await api("/api/vote", {
      method: "POST",
      body: JSON.stringify({
        candidateId: Number(candidateSelect.value),
      }),
    });
    voteMessage.textContent =
      "Vote recorded. Blockchain and hash unlock after 5 minutes, final count unlocks after 15 minutes from voting start.";
    await refreshDashboard();
  } catch (error) {
    voteMessage.textContent = error.message;
  }
});

tabVote.addEventListener("click", () => setActiveTab("vote"));
tabResults.addEventListener("click", () => setActiveTab("results"));
tabChain.addEventListener("click", () => setActiveTab("chain"));

logoutBtn.addEventListener("click", () => {
  clearToken();
  showAuth();
  otpVerifyForm.classList.add("hidden");
  authMessage.textContent = "";
  aadhaarMode = false;
  aadhaarFields.classList.add("hidden");
  voterIdInput.disabled = false;
  otpRequestBtn.textContent = "Generate Demo OTP";
});

(async function bootstrap() {
  const token = getToken();
  if (!token) {
    showAuth();
    return;
  }
  try {
    showDashboard();
    setActiveTab("vote");
    await refreshDashboard();
    currentStep = 1;
    renderSteps();
  } catch (error) {
    clearToken();
    showAuth();
  }
})();

renderSteps();
