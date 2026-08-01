import React, { useCallback, useEffect, useState } from 'react';
import BusinessDocumentPage from '../components/BusinessDocumentPage';
import QuoteTemplatePanel from '../components/QuoteTemplatePanel';
import { useData } from '../hooks/useData';
import { useAuth } from '../contexts/AuthContext';
import { apiClient } from '../services/api';

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
  const { hasPermission } = useAuth();
  const [quoteTemplates, setQuoteTemplates] = useState([]);
  const loadTemplates = useCallback(async () => {
    if (!hasPermission('quotes.view')) return;
    try { setQuoteTemplates((await apiClient.get('/quote-templates')).data || []); } catch (error) { console.error('Caricamento modelli Word fallito:', error); }
  }, [hasPermission]);
  useEffect(() => { void loadTemplates(); }, [loadTemplates]);

  return (
    <>
      {hasPermission('quotes.create') && <div className="px-6 pt-6"><QuoteTemplatePanel templates={quoteTemplates} onChanged={loadTemplates} /></div>}
      <BusinessDocumentPage
      kind="quote"
      documents={quotes}
      customers={customers}
      projects={projects}
      quotes={quotes}
      materials={materials}
      quoteTemplates={quoteTemplates}
      addDocument={addQuote}
      updateDocument={updateQuote}
      deleteDocument={deleteQuote}
      />
    </>
  );
};

export default QuotesPage;
