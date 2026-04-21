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
  InlineStack,
  BlockStack,
  useIndexResourceState,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import crypto from "crypto";

export async function loader({ request }: LoaderFunctionArgs) {
  await authenticate.admin(request);

  const campaigns = await prisma.qRCampaign.findMany({
    include: {
      pack: { include: { tier: true } },
      _count: { select: { redemptions: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  const packs = await prisma.pack.findMany({
    where: { isActive: true },
    include: { tier: true },
    orderBy: { name: "asc" },
  });

  return { campaigns, packs };
}

export async function action({ request }: ActionFunctionArgs) {
  await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "create") {
    const packId = formData.get("packId") as string;
    const maxRedemptions = formData.get("maxRedemptions") as string;
    const customHash = formData.get("customHash") as string;

    // Generate a campaign hash: use custom or auto-generate
    const campaignHash =
      customHash?.trim() ||
      `QR-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;

    await prisma.qRCampaign.create({
      data: {
        campaignHash,
        packId,
        maxRedemptions: maxRedemptions ? parseInt(maxRedemptions) : null,
      },
    });
    return { success: true };
  }

  if (intent === "toggle") {
    const campaignId = formData.get("campaignId") as string;
    const campaign = await prisma.qRCampaign.findUnique({
      where: { id: campaignId },
    });
    if (campaign) {
      await prisma.qRCampaign.update({
        where: { id: campaignId },
        data: { isActive: !campaign.isActive },
      });
    }
    return { success: true };
  }

  return { success: false };
}

export default function QRCampaignsPage() {
  const { campaigns, packs } = useLoaderData<typeof loader>();
  const submit = useSubmit();
  const nav = useNavigation();
  const isSaving =
    nav.state === "submitting" && nav.formData?.get("intent") === "create";

  const [modalOpen, setModalOpen] = useState(false);
  const toggleModal = useCallback(
    () => setModalOpen((prev) => !prev),
    [],
  );

  const [selectedPack, setSelectedPack] = useState(packs[0]?.id || "");
  const [maxRedemptions, setMaxRedemptions] = useState("");
  const [customHash, setCustomHash] = useState("");

  const handleCreate = useCallback(() => {
    submit(
      {
        intent: "create",
        packId: selectedPack,
        maxRedemptions,
        customHash,
      },
      { method: "post" },
    );
    setModalOpen(false);
    setMaxRedemptions("");
    setCustomHash("");
  }, [selectedPack, maxRedemptions, customHash, submit]);

  const handleToggle = useCallback(
    (id: string) => {
      submit({ intent: "toggle", campaignId: id }, { method: "post" });
    },
    [submit],
  );

  const resourceName = { singular: "campaign", plural: "campaigns" };
  const { selectedResources, allResourcesSelected, handleSelectionChange } =
    useIndexResourceState(campaigns);

  const rowMarkup = campaigns.map((campaign, index) => (
    <IndexTable.Row
      id={campaign.id}
      key={campaign.id}
      selected={selectedResources.includes(campaign.id)}
      position={index}
    >
      <IndexTable.Cell>
        <Text fontWeight="bold" as="span">
          {campaign.campaignHash}
        </Text>
      </IndexTable.Cell>
      <IndexTable.Cell>{campaign.pack.name}</IndexTable.Cell>
      <IndexTable.Cell>
        <Badge tone={campaign.pack.tier.level >= 3 ? "magic" : "info"}>
          {campaign.pack.tier.name}
        </Badge>
      </IndexTable.Cell>
      <IndexTable.Cell>
        {campaign._count.redemptions}
        {campaign.maxRedemptions ? ` / ${campaign.maxRedemptions}` : ""}
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Badge tone={campaign.isActive ? "success" : "critical"}>
          {campaign.isActive ? "Active" : "Inactive"}
        </Badge>
      </IndexTable.Cell>
      <IndexTable.Cell>
        {new Date(campaign.createdAt).toLocaleDateString()}
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Button
          size="micro"
          onClick={() => handleToggle(campaign.id)}
        >
          {campaign.isActive ? "Deactivate" : "Activate"}
        </Button>
      </IndexTable.Cell>
    </IndexTable.Row>
  ));

  return (
    <Page
      title="QR Campaigns"
      backAction={{ content: "Home", url: "/app" }}
      primaryAction={{ content: "Create Campaign", onAction: toggleModal }}
    >
      <Layout>
        <Layout.Section>
          <Card padding="0">
            <IndexTable
              resourceName={resourceName}
              itemCount={campaigns.length}
              selectedItemsCount={
                allResourcesSelected ? "All" : selectedResources.length
              }
              onSelectionChange={handleSelectionChange}
              headings={[
                { title: "Hash Code" },
                { title: "Pack" },
                { title: "Tier" },
                { title: "Redemptions" },
                { title: "Status" },
                { title: "Created" },
                { title: "Actions" },
              ]}
            >
              {rowMarkup}
            </IndexTable>
          </Card>
        </Layout.Section>

        <Layout.Section variant="oneThird">
          <Card>
            <BlockStack gap="200">
              <Text as="h2" variant="headingMd">
                How QR Campaigns Work
              </Text>
              <Text as="p" variant="bodyMd">
                Each campaign generates a unique hash code (e.g.{" "}
                <strong>SMMR-QR-2026</strong>) that maps to a specific digital
                Pack.
              </Text>
              <Text as="p" variant="bodyMd">
                When a customer scans a QR code containing this hash, they are
                prompted to enter their email. After verifying via magic link,
                the Pack is automatically granted to their account.
              </Text>
              <Text as="p" variant="bodyMd">
                You can set an optional redemption cap to limit scarcity-driven
                campaigns.
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>

      <Modal
        open={modalOpen}
        onClose={toggleModal}
        title="Create a QR Campaign"
        primaryAction={{
          content: "Create Campaign",
          onAction: handleCreate,
          loading: isSaving,
        }}
        secondaryActions={[{ content: "Cancel", onAction: toggleModal }]}
      >
        <Modal.Section>
          <FormLayout>
            <Select
              label="Target Pack"
              options={packs.map((p) => ({
                label: `${p.name} (${p.tier.name})`,
                value: p.id,
              }))}
              value={selectedPack}
              onChange={setSelectedPack}
              helpText="The pack customers will receive when they redeem this QR code."
            />
            <TextField
              label="Custom Hash (optional)"
              value={customHash}
              onChange={setCustomHash}
              autoComplete="off"
              placeholder="e.g. HOLIDAY-2026"
              helpText="Leave blank to auto-generate a unique code."
            />
            <TextField
              label="Max Redemptions (optional)"
              type="number"
              value={maxRedemptions}
              onChange={setMaxRedemptions}
              autoComplete="off"
              helpText="Leave blank for unlimited redemptions."
            />
          </FormLayout>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
