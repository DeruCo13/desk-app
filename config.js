// Public config. No secrets here.
window.DESK_CONFIG = {
  owner: "DeruCo13", repo: "desk-app", branch: "data",
  pollMs: 65000,        // unauthenticated GitHub API allows 60 requests/hour per IP
  pollFastMs: 15000     // used when a read token is saved in Account (5000/hour)
};
