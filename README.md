# Spec Battle RPG

A turn-based RPG where a federal construction **Engineer** battles a **Contractor** using specification language, contract clauses, and bureaucratic warfare.

Set in the world of NAVFAC federal construction, the humor comes from real adversarial dynamics — rejected submittals, weaponized RFIs, invoked SHALL clauses, and claims of Differing Site Conditions.

## Prerequisites

You need **Node.js** (version 18 or newer) installed on your computer. Node.js includes **npm**, the package manager used to install dependencies and run the app.

1. Go to [https://nodejs.org](https://nodejs.org)
2. Download the **LTS** (Long Term Support) version for your operating system
3. Run the installer and follow the prompts (default settings are fine)
4. Verify the installation by opening a terminal and running:
   ```bash
   node --version
   npm --version
   ```
   Both commands should print a version number.

## Install & Run

Open a terminal, navigate to the project folder, and run:

```bash
npm install
npm run dev
```

The first command downloads the project's dependencies. The second starts a local development server. Open the URL shown in the terminal (typically [http://localhost:5173](http://localhost:5173)) in your web browser.

## Build for Production

To create an optimized build for deployment:

```bash
npm run build
npm run preview
```
