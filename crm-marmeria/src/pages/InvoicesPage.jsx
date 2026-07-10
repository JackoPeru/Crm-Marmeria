import React from 'react';
import BusinessDocumentPage from '../components/BusinessDocumentPage';
import { useData } from '../hooks/useData';

const InvoicesPage = () => {
  const {
    invoices,
    quotes,
    customers,
    projects,
    materials,
    addInvoice,
    updateInvoice,
    deleteInvoice,
  } = useData();

  return (
    <BusinessDocumentPage
      kind="invoice"
      documents={invoices}
      customers={customers}
      projects={projects}
      quotes={quotes}
      materials={materials}
      addDocument={addInvoice}
      updateDocument={updateInvoice}
      deleteDocument={deleteInvoice}
    />
  );
};

export default InvoicesPage;
