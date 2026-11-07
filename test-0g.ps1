$env:ZERO_G_ROUTER_BASE_URL = "https://router-api.0g.ai/v1"
$env:ZERO_G_ROUTER_API_KEY = "sk-9ab48a55-1ad8-4f9d-ad1c-51bfab515bde"
$env:ZERO_G_MODEL_ID = "0gm-1.0-35b-a3b-sia"

const fetch = require("node-fetch").default;

const baseUrl = process.env.ZERO_G_ROUTER_BASE_URL;
const apiKey = process.env.ZERO_G_ROUTER_API_KEY;
const modelId = process.env.ZERO_G_MODEL_ID;

console.log("Endpoint:", baseUrl);
console.log("Model:", modelId);
console.log("API Key starts with sk-:", apiKey?.startsWith("sk-"));

async function test0G() {
  const body = JSON.stringify({
    model: modelId,
    messages: [
      {"role": "user", "content": "Continue the mission"}
    ],
    temperature: 0,
    max_tokens: 128,
    n: 1,
    stream: false,
    verify_tee: true
  });

  const endpoint = baseUrl + "/chat/completions";
  console.log("\nEndpoint:", endpoint);

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + apiKey
      },
      body: body
    });

    console.log("Status:", res.status);
    const text = await res.text();
    console.log("Response text (first 500):", text.substring(0, 500));
    console.log("ZG-Res-Key header:", res.headers.get("ZG-Res-Key"));
    
    // Check if we can parse JSON
    try {
      const json = JSON.parse(text);
      console.log("Parsed JSON ok");
      console.log("Has x_0g_trace:", json.x_0g_trace ? "yes" : "no");
      console.log("Has id in trace:", json.x_0g_trace?.request_id ? "yes" : "no");
      console.log("tee_verified:", json.x_0g_trace?.tee_verified);
    } catch(e) {
      console.log("Response is not JSON:", e.message);
    }
  } catch(e) {
    console.log("Fetch error:", e.message);
  }
}

test0G();