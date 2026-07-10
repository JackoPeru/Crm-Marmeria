import React from 'react';
import BusinessDocumentPage from '../components/BusinessDocumentPage';
import { useData } from '../hooks/useData';

const QuotesPage = () => {
  const {
    quotes,
    customers,
    projects,
    materials,
    addQuote,
    updateQuote,
    deleteQuote,
  } = useData();

  return (
    <BusinessDocumentPage
      kind="quote"
      documents={quotes}
      customers={customers}
      projects={projects}
      quotes={quotes}
      materials={materials}
      addDocument={addQuote}
      updateDocument={updateQuote}
      deleteDocument={deleteQuote}
    />
  );
};

export default QuotesPage;
