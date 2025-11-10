/**
 * Provides actionable suggestions based on HTTP status code
 * @param {number} statusCode - HTTP response status code
 * @returns {Array<{ message: string, link?: string }>} - Array of suggestions with optional reference links
 */
export function getSuggestions(statusCode) {
  const suggestionsMap = {
    // Client errors
    400: [
      { message: "Invalid request format or API key." },
      { message: "Check your GEMINI_MODEL environment variable." },
      { message: "Ensure the API key is correct, with no extra spaces." },
    ],
    401: [
      { message: "Unauthorized request." },
      { message: "Verify API key or authentication token." },
    ],
    403: [
      { message: "Generative Language API not enabled in Google Cloud." },
      { message: "Check billing is set up if required." },
      { message: "Review IAM permissions for the project." },
    ],
    404: [
      { message: "Incorrect model name." },
      { message: "Try updating GEMINI_MODEL in .env." },
      { message: "Check available models: gemini-1.5-flash, gemini-1.5-pro." }
    ],
    429: [
      { message: "Rate limit exceeded, try again later." },
      { message: "Consider upgrading your quota in Google Cloud." },
      { message: "Implement exponential backoff retries in code." }
    ],

    // Server errors
    500: [
      { message: "Google internal server error." },
      { message: "Retry the request after a short delay." }
    ],
    503: [
      { message: "Service unavailable, try again later." },
      { message: "Check Google Cloud status page for outages.", link: "https://status.cloud.google.com/" }
    ]
  };

  // Fallback for unknown errors
  const defaultSuggestions = [
    { message: "Unknown error occurred. Verify configuration and network connectivity." },
    { message: "Check logs for more details." }
  ];

  return suggestionsMap[statusCode] || defaultSuggestions;
}
