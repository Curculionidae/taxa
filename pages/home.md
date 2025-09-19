---
title: "TaxonPages: Curculionidae of the World"
lead: "The database has a comprehansive checklist of the Curculionidae. So far, the effort has been dedicated to the subfamily Entiminae."
project: "TaxonPages: Curculionidae of the World"
---
<div style="display: flex; justify-content: center; align-items: center; flex-direction: column;">
  <table style="border: 0">
    <tr>
      <td>
        <a href="https://curculionidae.github.io/taxa/#/otus/723601/overview">
          <img src="../public/images/otiorhynchus_carinatopunctatus_500.png" 
               alt="Otiorhynchus (Nihus) carinatopunctatus (Retzius, 1783). Photo by Jakob Jilg" 
               title="Otiorhynchus (Nihus) carinatopunctatus (Retzius, 1783). Photo by Jakob Jilg">
        </a>
      </td>
      <td>
        <a href="https://curculionidae.github.io/taxa/#/otus/729972/overview">
          <img src="../public/images/chlorophanus_viridis_500.png" 
               alt="Chlorophanus viridis (Linnaeus, 1758). Photo by Jakob Jilg" 
               title="Chlorophanus viridis (Linnaeus, 1758). Photo by Jakob Jilg">
        </a>
      </td>
      <td>
        <a href="https://curculionidae.github.io/taxa/#/otus/718330/overview">
          <img src="../public/images/exophtalmus_triangulifer_500.png" 
               alt="Exophthalmus triangulifer Champion, 1911. Photo by Jakob Jilg" 
               title="Exophthalmus triangulifer Champion, 1911. Photo by Jakob Jilg">
        </a>
      </td>
    </tr>
  </table>

  <!-- Vue components moved outside the table -->
  <div style="text-align: center; margin-top: 1rem;">
    Valid Species: <ValidSpeciesCount></ValidSpeciesCount>; 
    <ProjectStats :data="['Taxon names', 'Collection objects', 'Project sources', 'Documents', 'Images']" class="capitalize"></ProjectStats>
  </div>
</div>

<div class="mx-auto flex flex-col items-center mt-6 sm:mt-10 w-full">
  <autocomplete-otu class="w-full sm:w-96 text-base-content ml-2 sm:ml-0" placeholder="Search by taxon name" autofocus/>
</div>

<div style="text-align: center; margin: 0 auto; line-height: 1.6;">
  <p style="font-weight: 500; font-size: 1.1rem;">
    Enter a taxon name in the search field to start exploring (e.g., <a href="http://localhost:5173/taxonpages/#/otus/712818/overview">Entiminae</a>).
  </p>
  <p style="font-size: 1rem;">
    This catalog is a <strong>work in progress</strong>. So far, the effort has been dedicated to the subfamily <strong>Entiminae</strong>.<br> 
    If you find information gaps in Entiminae, or if you would like to join the effort to update any Curculionid group, 
    just send us an email at 
    <a href="mailto:WeevilWorkers@gmail.com" style="text-decoration: underline;">WeevilWorkers@gmail.com</a>.
  </p>
</div>
