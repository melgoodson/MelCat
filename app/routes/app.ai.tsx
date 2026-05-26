import { Page, Layout, Card, Text, BlockStack, InlineStack, Badge, Button, Divider, Box, ProgressBar } from "@shopify/polaris";
import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return null;
};

export default function AISkeleton() {
  return (
    <Page title="AI & Gamification (Coming Soon)">
      <Layout>
        <Layout.Section>
          <Card padding="500">
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <InlineStack gap="400" blockAlign="center">
                  <div style={{ width: '64px', height: '64px', borderRadius: '50%', overflow: 'hidden', border: '2px solid #f28c28', boxShadow: '0 4px 12px rgba(242, 140, 40, 0.2)' }}>
                    <img src="/melcat-ai-preview.png" alt="MelCat Avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  </div>
                  <Text variant="headingLg" as="h2">MelCat AI Companion</Text>
                </InlineStack>
                <Badge tone="magic">Beta Features</Badge>
              </InlineStack>
              <Text variant="bodyMd" as="p" tone="subdued">
                Configure the personality, sass level, and unlockable responses for your customers' AI pet companions.
              </Text>

              <Divider />

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
                <div style={{ padding: "1rem", border: "1px dashed #e1e3e5", borderRadius: "8px", background: "#f9fafb" }}>
                  <InlineStack gap="200" align="start">
                    <div style={{ fontSize: "1.2rem" }}>✨</div>
                    <BlockStack gap="100">
                      <Text variant="headingSm" as="h3">Sass Level Configuration</Text>
                      <Text variant="bodySm" tone="subdued">Adjust how snarky the AI responds based on user tier.</Text>
                      <Box paddingBlockStart="200">
                        <ProgressBar progress={75} tone="magic" />
                      </Box>
                    </BlockStack>
                  </InlineStack>
                </div>

                <div style={{ padding: "1rem", border: "1px dashed #e1e3e5", borderRadius: "8px", background: "#f9fafb" }}>
                  <InlineStack gap="200" align="start">
                    <div style={{ fontSize: "1.2rem" }}>🔮</div>
                    <BlockStack gap="100">
                      <Text variant="headingSm" as="h3">Dynamic Personality Core</Text>
                      <Text variant="bodySm" tone="subdued">AI adapts to how often the customer interacts with their vault.</Text>
                      <Box paddingBlockStart="200">
                        <Button disabled size="micro">Configure Prompts</Button>
                      </Box>
                    </BlockStack>
                  </InlineStack>
                </div>
              </div>

              <Box paddingBlockStart="400">
                <Text variant="headingMd" as="h3">Customer Preview</Text>
                <div style={{ marginTop: '1rem', padding: '1.5rem', background: '#fff', borderRadius: '16px', border: '1px solid #e1e3e5', boxShadow: '0 4px 12px rgba(0,0,0,0.05)' }}>
                  
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                      <span style={{ fontSize: '1.25rem' }}>🐾</span>
                      <h3 style={{ margin: 0, fontSize: '1.1rem', color: '#2d1b0d', fontWeight: 700 }}>MelCat's Corner</h3>
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '1.5rem', alignItems: 'center' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem' }}>
                      <div style={{ width: '100px', height: '100px', borderRadius: '50%', overflow: 'hidden', border: '3px solid #f28c28', position: 'relative', background: '#fff9f0' }}>
                        <img src="/melcat-ai-preview.png" style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt="MelCat Companion" />
                      </div>
                      <div style={{ background: '#2d1b0d', color: '#fff', padding: '0.2rem 1rem', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 700, marginTop: '-15px', zIndex: 10 }}>
                        LVL 1
                      </div>
                      <span style={{ fontSize: '0.75rem', color: '#6b5c4f', fontWeight: 600 }}>0 / 100 XP</span>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                      <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', marginBottom: '0.25rem', fontWeight: 600, color: '#2d1b0d' }}>
                          <span>🐟 Hunger</span>
                          <span style={{ color: '#e94560' }}>Starving!</span>
                        </div>
                        <div style={{ height: '6px', background: '#f1f5f9', borderRadius: '3px', overflow: 'hidden' }}>
                          <div style={{ width: '15%', height: '100%', background: '#e94560' }} />
                        </div>
                      </div>

                      <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', marginBottom: '0.25rem', fontWeight: 600, color: '#2d1b0d' }}>
                          <span>🎾 Happiness</span>
                          <span style={{ color: '#f28c28' }}>Bored</span>
                        </div>
                        <div style={{ height: '6px', background: '#f1f5f9', borderRadius: '3px', overflow: 'hidden' }}>
                          <div style={{ width: '40%', height: '100%', background: '#f28c28' }} />
                        </div>
                      </div>

                      <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', marginBottom: '0.25rem', fontWeight: 600, color: '#2d1b0d' }}>
                          <span>💅 Sass Level</span>
                          <span style={{ color: '#8a2be2' }}>Maximum</span>
                        </div>
                        <div style={{ height: '6px', background: '#f1f5f9', borderRadius: '3px', overflow: 'hidden' }}>
                          <div style={{ width: '100%', height: '100%', background: 'linear-gradient(90deg, #f28c28, #8a2be2)' }} />
                        </div>
                      </div>
                    </div>
                  </div>

                  <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '0.75rem', marginTop: '1.25rem', fontStyle: 'italic', color: '#475569', fontSize: '0.8rem', textAlign: 'center' }}>
                    "I'm not saying I'm hungry, but if you don't feed me a treat soon, your internet cables are looking awfully chewable."
                  </div>

                  <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1.25rem' }}>
                    <button disabled style={{ flex: 1, padding: '0.5rem', background: '#f1f5f9', color: '#94a3b8', border: 'none', borderRadius: '8px', fontWeight: 600, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.25rem' }}>
                      <span style={{ fontSize: '1.1rem' }}>🐟</span>
                      <span style={{ fontSize: '0.65rem' }}>Feed (0)</span>
                    </button>
                    <button disabled style={{ flex: 1, padding: '0.5rem', background: '#f1f5f9', color: '#94a3b8', border: 'none', borderRadius: '8px', fontWeight: 600, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.25rem' }}>
                      <span style={{ fontSize: '1.1rem' }}>🎾</span>
                      <span style={{ fontSize: '0.65rem' }}>Play</span>
                    </button>
                    <button disabled style={{ flex: 1, padding: '0.5rem', background: '#f1f5f9', color: '#94a3b8', border: 'none', borderRadius: '8px', fontWeight: 600, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.25rem' }}>
                      <span style={{ fontSize: '1.1rem' }}>💬</span>
                      <span style={{ fontSize: '0.65rem' }}>Chat</span>
                    </button>
                  </div>
                </div>
              </Box>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section variant="oneThird">
          <Card padding="500">
            <BlockStack gap="400">
              <InlineStack gap="200">
                <div style={{ fontSize: "1.2rem" }}>⭐</div>
                <Text variant="headingMd" as="h2">Reward Mechanics</Text>
              </InlineStack>
              <Text variant="bodySm" as="p" tone="subdued">
                Rules engine for points, streaks, and badges.
              </Text>
              <BlockStack gap="200">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <Text variant="bodyMd" as="span">Daily Login Streak</Text>
                  <Badge>Locked</Badge>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <Text variant="bodyMd" as="span">QR Scan Achievements</Text>
                  <Badge>Locked</Badge>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <Text variant="bodyMd" as="span">Upgrade Rewards</Text>
                  <Badge>Locked</Badge>
                </div>
              </BlockStack>
              <Button disabled fullWidth>Enable Gamification Module</Button>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
