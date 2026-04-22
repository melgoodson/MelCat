import { useState, useCallback } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useSubmit, useNavigation } from "react-router";
import {
  Page,
  Layout,
  Card,
  Text,
  IndexTable,
  Button,
  Modal,
  FormLayout,
  TextField,
  Select,
  Badge,
  BlockStack,
  useIndexResourceState
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export async function loader({ request }: LoaderFunctionArgs) {
  await authenticate.admin(request);
  
  let tiers = await prisma.tier.findMany({
    orderBy: { level: 'asc' }
  });

  // Self-Healing auto-seed for isolated environments
  if (tiers.length === 0) {
    console.log("No tiers found! Auto-seeding database...");
    await prisma.tier.createMany({
      data: [
        { name: 'Lite', level: 1 },
        { name: 'Standard', level: 2 },
        { name: 'Deluxe', level: 3 },
        { name: 'Ultimate', level: 4 }
      ]
    });
    tiers = await prisma.tier.findMany({ orderBy: { level: 'asc' } });
  }
  
  const packs = await prisma.pack.findMany({
    include: { tier: true, _count: { select: { packAssets: true, qrCampaigns: true } } },
    orderBy: { createdAt: 'desc' }
  });

  return { tiers, packs };
}

export async function action({ request }: ActionFunctionArgs) {
  await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "create") {
    const name = formData.get("name") as string;
    const tierId = formData.get("tierId") as string;
    
    if (name && tierId) {
      await prisma.pack.create({
        data: { name, tierId }
      });
    }
    return { success: true };
  }
  
  if (intent === "delete") {
    const packId = formData.get("packId") as string;
    await prisma.pack.update({
      where: { id: packId },
      data: { isActive: false }
    });
    return { success: true };
  }

  return { success: false };
}

export default function PacksManager() {
  const { tiers, packs } = useLoaderData<typeof loader>();
  const submit = useSubmit();
  const nav = useNavigation();
  const isSaving = nav.state === "submitting" && nav.formData?.get("intent") === "create";

  const [active, setActive] = useState(false);
  const toggleModal = useCallback(() => setActive((active) => !active), []);

  const [packName, setPackName] = useState("");
  const [selectedTier, setSelectedTier] = useState(tiers[0]?.id || "");

  const handleCreate = useCallback(() => {
    submit({ intent: "create", name: packName, tierId: selectedTier }, { method: "post" });
    setActive(false);
    setPackName("");
  }, [packName, selectedTier, submit]);

  const handleDelete = useCallback((id: string) => {
    submit({ intent: "delete", packId: id }, { method: "post" });
  }, [submit]);

  const activePacks = packs.filter(p => p.isActive);

  const resourceName = { singular: 'pack', plural: 'packs' };
  const { selectedResources, allResourcesSelected, handleSelectionChange } = 
    useIndexResourceState(activePacks);

  const rowMarkup = activePacks.map(
    ({ id, name, tier, _count, createdAt }, index) => (
      <IndexTable.Row
        id={id}
        key={id}
        selected={selectedResources.includes(id)}
        position={index}
      >
        <IndexTable.Cell><Text fontWeight="bold" as="span">{name}</Text></IndexTable.Cell>
        <IndexTable.Cell>
          <Badge tone={tier.level >= 3 ? "magic" : "info"}>{tier.name}</Badge>
        </IndexTable.Cell>
        <IndexTable.Cell>{_count.packAssets} Assets</IndexTable.Cell>
        <IndexTable.Cell>{_count.qrCampaigns} Campaigns</IndexTable.Cell>
        <IndexTable.Cell>{new Date(createdAt).toLocaleDateString()}</IndexTable.Cell>
        <IndexTable.Cell>
            <Button size="micro" variant="primary" tone="critical" onClick={() => handleDelete(id)}>Delete</Button>
        </IndexTable.Cell>
      </IndexTable.Row>
    ),
  );

  return (
    <Page 
        title="Packs Manager" 
        backAction={{content: 'Home', url: '/app'}}
        primaryAction={{content: 'Create Pack', onAction: toggleModal}}
    >
      <Layout>
        <Layout.Section>
          <Card padding="500">
            <BlockStack gap="300">
              <Text variant="headingLg" as="h2">What are Digital Packs?</Text>
              <Text as="p">
                Packs act as secure folders or bundles that contain your digital files. You assign a Pack to a specific access Tier (Lite, Standard, or Ultimate).
              </Text>
              <Text as="p" fontWeight="bold">How to use it:</Text>
              <Text as="p" tone="subdued">
                Click "Create Pack", give it a name, and choose the Tier it belongs to. Later, you'll upload your secure assets and attach them to these packs.
              </Text>
              <Text as="p" fontWeight="bold">Example:</Text>
              <Text as="p" tone="subdued">
                You might create a pack called "New Kitten Training Course" and assign it to the "Standard Tier".
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>
        <Layout.Section>
          <Card padding="0">
            <IndexTable
              resourceName={resourceName}
              itemCount={activePacks.length}
              selectedItemsCount={
                allResourcesSelected ? 'All' : selectedResources.length
              }
              onSelectionChange={handleSelectionChange}
              headings={[
                { title: 'Name' },
                { title: 'Tier' },
                { title: 'Assets' },
                { title: 'QR Campaigns' },
                { title: 'Created' },
                { title: 'Actions' }
              ]}
            >
              {rowMarkup}
            </IndexTable>
          </Card>
        </Layout.Section>
      </Layout>

      <Modal
        open={active}
        onClose={toggleModal}
        title="Create a new Digital Pack"
        primaryAction={{
          content: 'Save Pack',
          onAction: handleCreate,
          loading: isSaving,
        }}
        secondaryActions={[
          {
            content: 'Cancel',
            onAction: toggleModal,
          },
        ]}
      >
        <Modal.Section>
          <FormLayout>
            <TextField
              label="Pack Name"
              value={packName}
              onChange={setPackName}
              autoComplete="off"
              helpText="Give this pack a memorable name like 'Winter Drop Ultimate'."
            />
            <Select
              label="Assigned Tier"
              options={tiers.map(t => ({ label: `${t.name} (Level ${t.level})`, value: t.id }))}
              value={selectedTier}
              onChange={setSelectedTier}
              helpText="This determines which customers gain access based on their physical purchase level."
            />
          </FormLayout>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
