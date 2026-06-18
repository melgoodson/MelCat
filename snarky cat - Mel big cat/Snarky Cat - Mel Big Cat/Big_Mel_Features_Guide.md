# Big Mel Storefront Companion
## Feature & Behavior Guide

This guide explains all the interactive features and automated behaviors built into the Big Mel storefront companion.

---

### 1. Context-Aware Interactions
Big Mel doesn't just say random things—he responds to exactly where the customer is and what they are doing.

*   **Welcome Greetings:** When a customer first loads the site, Big Mel walks in from the bottom of the screen and drops a branded welcome message (e.g., *"Hey. Welcome to Snarky Pets. Try not to be boring."*).
*   **Page-Specific Snark:** 
    *   **Home/Collections:** Judges their indecision (*"I can smell the indecision from here."*).
    *   **Product Page:** Pressures them to buy (*"That thing's been staring at you for 30 seconds."*).
    *   **Cart:** Encourages completion (*"You're SO close. Don't chicken out now."*).
*   **Idle Engagement:** If a user sits on a page doing nothing for 45–90 seconds, Mel drops an unprompted snarky comment to re-engage them (*"Still here. Still judging."*).

### 2. Actionable Call-to-Actions (CTAs)
Big Mel acts as a conversion tool by providing buttons right inside his speech bubbles.

*   **"Shop more chaos":** Shown on the homepage to push users to the collections page.
*   **"Add it already →":** Shown on product pages. Clicking this automatically scrolls the user down directly to the store's "Add to Cart" button.
*   **"Checkout →":** Shown on the cart page to push users straight to the payment flow.

### 3. Smart Detection & Feedback
Big Mel watches what the user does and provides immediate feedback.

*   **Add-to-Cart Celebration:** Big Mel detects when an item is successfully added to the cart (via clicking the button or updating the cart drawer). He immediately does a "celebration jump" animation and drops a sarcastic approval message (*"Finally. A financially responsible bad decision."*).
*   **Tap Responses:** If a user clicks on Big Mel, he recoils (a quick shrink animation) and drops a random snarky response.
*   **Reading Time:** If a user hovers their mouse over a speech bubble, the auto-hide timer pauses so they have as much time as they need to read it.

### 4. Automated "Life-like" Behaviors
Big Mel is brought to life using custom-animated GIF assets for each emotional state, mapped dynamically via JavaScript.

*   **Breathing & Floating:** The default `idle` state continuously plays a smooth breathing animation.
*   **Prowling:** Occasionally, he will shift his position to the left or right. The JavaScript pacing exactly matches the CSS linear transition (4 seconds) so his walking animation seamlessly syncs with his movement across the screen, avoiding any "ice skater" gliding effect.
*   **Sleeping:** If the user ignores the page completely for several minutes, his state updates to play the slow, heavy `sleeping` GIF animation (*"zzz... *judging you in dreams*"*) until the user interacts again.

### 5. Asset Management & Architecture
Because Shopify Theme App Extensions have strict size limits and do not support `.gif` or `.webp` files in their local `assets/` directories, the companion uses a decoupled asset strategy:
*   The high-quality emotion GIFs (`melcat-idle.gif`, `melcat-walking.gif`, etc.) are hosted directly in the store's global **Shopify Admin > Content > Files** section.
*   The `companion.liquid` block injects these global CDN URLs into the frontend using the `file_url` filter.
*   The JavaScript state machine smoothly swaps the image `src` based on the active state.

### 6. User Experience & Politeness Rules
While Big Mel is snarky, the code is designed to be highly respectful of the shopping experience.

*   **The "Tap Me" Hint:** If a new user doesn't realize he is interactive within the first 9 seconds, an orange ring gently pulses around him and a tiny "tap me" label appears. Once they click him, the hint system disables itself forever.
*   **Session Minimize:** Users can dismiss him at any time using the "X" button. He will stay completely hidden for the rest of their browsing session.
*   **Zero Distractions at Checkout:** He completely disables himself on the checkout page so there are no distractions when it's time to pay.
*   **Performance First:** Built entirely with vanilla JavaScript and CSS (no heavy external libraries). By serving assets via Shopify's edge CDN, he has zero negative impact on your Shopify store's load speed.
