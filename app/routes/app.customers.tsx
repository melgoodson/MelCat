import { useState, useCallback } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useSubmit, useNavigation } from "react-router";
import {
  Page,
  Layout,
  Card,
  Text,
  IndexTable,
  Badge,
  Button,
  Modal,
  FormLayout,
  TextField,
  Banner,
  BlockStack,
  useIndexResourceState,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { mergeCustomerProfiles } from "../services/customerMerge.server";
import prisma from "../db.server";

export async function loader({ request }: LoaderFunctionArgs) {
  await authenticate.admin(request);

  const customers = await prisma.customer.findMany({
    include: {
      entitlements: {
        where: { revoked: false },
        include: { pack: { include: { tier: true } } },
      },
      _count: { select: { redemptions: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  const totalCustomers = await prisma.customer.count();
  const totalEntitlements = await prisma.entitlement.count({
    where: { revoked: false },
  });

  return { customers, totalCustomers, totalEntitlements };
}

export async function action({ request }: ActionFunctionArgs) {
  await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "merge") {
    const sourceEmail = formData.get("sourceEmail") as string;
    const targetEmail = formData.get("targetEmail") as string;
    try {
      await mergeCustomerProfiles(sourceEmail, targetEmail);
      return { success: true };
    } catch (err: any) {
      return { error: err.message };
    }
  }

  return { error: "Unknown intent" };
}

export default function CustomersPage() {
  const { customers, totalCustomers, totalEntitlements } = useLoaderData<typeof loader>();
  const submit = useSubmit();
  const nav = useNavigation();
  const isMerging = nav.state === "submitting" && nav.formData?.get("intent") === "merge";

  const [modalOpen, setModalOpen] = useState(false);
  const toggleModal = useCallback(() => setModalOpen((active) => !active), []);

  const [sourceEmail, setSourceEmail] = useState("");
  const [targetEmail, setTargetEmail] = useState("");

  const handleMerge = useCallback(() => {
    submit({ intent: "merge", sourceEmail, targetEmail }, { method: "post" });
    setModalOpen(false);
    setSourceEmail("");
    setTargetEmail("");
  }, [sourceEmail, targetEmail, submit]);

  const resourceName = { singular: "customer", plural: "customers" };
  const { selectedResources, allResourcesSelected, handleSelectionChange } =
    useIndexResourceState(customers);

  const rowMarkup = customers.map((customer, index) => {
    const highestTier = customer.entitlements.reduce(
      (max, e) => Math.max(max, e.pack.tier.level),
      0,
    );
    const tierLabel =
      highestTier === 4
        ? "Ultimate"
        : highestTier === 3
          ? "Deluxe"
          : highestTier === 2
            ? "Standard"
            : highestTier === 1
              ? "Lite"
              : "None";

    return (
      <IndexTable.Row
        id={customer.id}
        key={customer.id}
        selected={selectedResources.includes(customer.id)}
        position={index}
      >
        <IndexTable.Cell>
          <Text fontWeight="bold" as="span">
            {customer.email}
          </Text>
        </IndexTable.Cell>
        <IndexTable.Cell>
          {customer.shopifyCustomerId || "—"}
        </IndexTable.Cell>
        <IndexTable.Cell>{customer.entitlements.length}</IndexTable.Cell>
        <IndexTable.Cell>
          <Badge tone={highestTier >= 3 ? "magic" : highestTier >= 1 ? "info" : "new"}>
            {tierLabel}
          </Badge>
        </IndexTable.Cell>
        <IndexTable.Cell>{customer._count.redemptions} QR</IndexTable.Cell>
        <IndexTable.Cell>
          {new Date(customer.createdAt).toLocaleDateString()}
        </IndexTable.Cell>
      </IndexTable.Row>
    );
  });

  return (
    <Page 
      title="Customers & Entitlements" 
      backAction={{ content: "Home", url: "/app" }}
      primaryAction={{ content: "Merge Profiles", onAction: toggleModal }}
    >
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            <Card>
              <BlockStack gap="200">
                <Text as="h2" variant="headingMd">
                  Overview
                </Text>
                <Text as="p" variant="bodyMd">
                  <strong>{totalCustomers}</strong> total customers &bull;{" "}
                  <strong>{totalEntitlements}</strong> active entitlements
                </Text>
              </BlockStack>
            </Card>
            <Card padding="0">
              <IndexTable
                resourceName={resourceName}
                itemCount={customers.length}
                selectedItemsCount={
                  allResourcesSelected ? "All" : selectedResources.length
                }
                onSelectionChange={handleSelectionChange}
                headings={[
                  { title: "Email" },
                  { title: "Shopify ID" },
                  { title: "Packs Owned" },
                  { title: "Highest Tier" },
                  { title: "QR Claims" },
                  { title: "Joined" },
                ]}
              >
                {rowMarkup}
              </IndexTable>
            </Card>
          </BlockStack>
        </Layout.Section>
      </Layout>

      <Modal
        open={modalOpen}
        onClose={toggleModal}
        title="Merge Customer Profiles"
        primaryAction={{
          content: "Merge Profiles",
          onAction: handleMerge,
          loading: isMerging,
          destructive: true,
        }}
        secondaryActions={[
          {
            content: "Cancel",
            onAction: toggleModal,
          },
        ]}
      >
        <Modal.Section>
          <FormLayout>
            <Banner tone="warning">
              <p>
                Merging is permanent. All packs and QR redemptions from the Source Email will be transferred to the Target Email. The Source Profile will be completely deleted.
              </p>
            </Banner>
            <TextField
              label="Source Email (to be deleted)"
              value={sourceEmail}
              onChange={setSourceEmail}
              autoComplete="off"
              helpText="e.g. bought with apple pay: old@icloud.com"
            />
            <TextField
              label="Target Email (survivor)"
              value={targetEmail}
              onChange={setTargetEmail}
              autoComplete="off"
              helpText="e.g. main account: current@gmail.com"
            />
          </FormLayout>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
