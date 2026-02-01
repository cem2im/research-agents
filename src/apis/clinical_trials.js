const BASE_URL = 'https://clinicaltrials.gov/api/v2';

class ClinicalTrialsAPI {
  async search(query, options = {}) {
    const {
      maxResults = 20,
      status = null, // 'RECRUITING', 'COMPLETED', 'ACTIVE_NOT_RECRUITING'
      phase = null,  // 'PHASE1', 'PHASE2', 'PHASE3', 'PHASE4'
      interventionType = null // 'DRUG', 'DEVICE', 'BIOLOGICAL'
    } = options;

    const params = new URLSearchParams({
      'query.term': query,
      pageSize: maxResults,
      format: 'json'
    });

    if (status) {
      params.set('filter.overallStatus', status);
    }
    if (phase) {
      params.set('filter.phase', phase);
    }

    const response = await fetch(`${BASE_URL}/studies?${params}`);

    if (!response.ok) {
      throw new Error(`ClinicalTrials.gov API error: ${response.status}`);
    }

    const data = await response.json();

    return (data.studies || []).map(study => this.normalizeStudy(study));
  }

  async getStudy(nctId) {
    const response = await fetch(`${BASE_URL}/studies/${nctId}?format=json`);

    if (!response.ok) {
      throw new Error(`ClinicalTrials.gov API error: ${response.status}`);
    }

    return this.normalizeStudy(await response.json());
  }

  normalizeStudy(study) {
    const protocol = study.protocolSection || {};
    const identification = protocol.identificationModule || {};
    const status = protocol.statusModule || {};
    const description = protocol.descriptionModule || {};
    const design = protocol.designModule || {};
    const arms = protocol.armsInterventionsModule || {};
    const eligibility = protocol.eligibilityModule || {};
    const contacts = protocol.contactsLocationsModule || {};
    const sponsors = protocol.sponsorCollaboratorsModule || {};

    // Extract interventions
    const interventions = (arms.interventions || []).map(i => ({
      type: i.type,
      name: i.name,
      description: i.description
    }));

    // Extract conditions
    const conditions = protocol.conditionsModule?.conditions || [];

    return {
      source: 'clinical_trials',
      external_id: identification.nctId,
      title: identification.officialTitle || identification.briefTitle || '',
      abstract: description.briefSummary || '',
      authors: [sponsors.leadSponsor?.name].filter(Boolean),
      publication_date: status.startDateStruct?.date || null,
      journal: null,
      url: `https://clinicaltrials.gov/study/${identification.nctId}`,
      citation_count: 0,
      influence_score: 0,
      keywords: conditions,
      mesh_terms: [],
      metadata: {
        nctId: identification.nctId,
        status: status.overallStatus,
        phase: design.phases?.join(', ') || 'N/A',
        studyType: design.studyType,
        enrollment: design.enrollmentInfo?.count,
        interventions,
        conditions,
        eligibility: {
          sex: eligibility.sex,
          minAge: eligibility.minimumAge,
          maxAge: eligibility.maximumAge,
          healthyVolunteers: eligibility.healthyVolunteers
        },
        sponsor: sponsors.leadSponsor?.name,
        completionDate: status.completionDateStruct?.date
      }
    };
  }

  // Search for trials in specific therapeutic area
  async searchTherapeuticArea(keywords, options = {}) {
    const query = keywords.join(' OR ');
    return this.search(query, options);
  }

  // Get competitor trials
  async getCompetitorTrials(companyName, options = {}) {
    return this.search(`SPONSOR:${companyName}`, options);
  }
}

export default ClinicalTrialsAPI;
