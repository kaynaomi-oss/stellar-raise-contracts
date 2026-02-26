import Head from "next/head";

interface SEOProps {
  title?: string;
  description?: string;
  canonical?: string;
  image?: string;
}

const DEFAULT_TITLE = "CrowdFund - Decentralized Crowdfunding on Stellar";
const DEFAULT_DESCRIPTION =
  "Launch and support campaigns on a transparent, decentralized crowdfunding platform built on the Stellar network using Soroban smart contracts.";
const DEFAULT_IMAGE = "/images/og-default.png";
const SITE_URL = "https://your-crowdfund-app.com";

const SEO = ({
  title = DEFAULT_TITLE,
  description = DEFAULT_DESCRIPTION,
  canonical,
  image = DEFAULT_IMAGE,
}: SEOProps) => {
  const fullTitle = title === DEFAULT_TITLE ? title : `${title} | CrowdFund`;

  const canonicalUrl = canonical ? `${SITE_URL}${canonical}` : SITE_URL;

  return (
    <Head>
      {/* Primary Meta Tags */}
      <title>{fullTitle}</title>
      <meta name="description" content={description} />

      {/* Viewport */}
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />

      {/* Canonical */}
      <link rel="canonical" href={canonicalUrl} />

      {/* Charset and language */}
      <meta charSet="UTF-8" />
      <meta httpEquiv="X-UA-Compatible" content="IE=edge" />

      {/* Robots */}
      <meta name="robots" content="index, follow" />

      {/* Open Graph */}
      <meta property="og:type" content="website" />
      <meta property="og:url" content={canonicalUrl} />
      <meta property="og:title" content={fullTitle} />
      <meta property="og:description" content={description} />
      <meta property="og:image" content={`${SITE_URL}${image}`} />

      {/* Twitter Card */}
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={fullTitle} />
      <meta name="twitter:description" content={description} />
      <meta name="twitter:image" content={`${SITE_URL}${image}`} />

      {/* Theme color */}
      <meta name="theme-color" content="#4f46e5" />
    </Head>
  );
};

export default SEO;
